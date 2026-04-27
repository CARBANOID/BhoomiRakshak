from __future__ import annotations

import concurrent.futures
import hashlib
import json
import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, cast, Optional

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("bhoomirakshak")
logging.basicConfig(level=logging.INFO)

try:
    import ee
except Exception:  # pragma: no cover - optional dependency at runtime
    ee = None

# ee.Initialize(project='bhoomirakshak-1755412704181')

# ================================================================
# GEE ASSET EXPORT CACHE
# ================================================================
_GEE_ASSET_BASE = os.getenv(
    "EE_ASSET_BASE",
    "projects/bhoomirakshak-1755412704181/assets"
)
 
_gee_memory_cache: dict[str, Any] = {}
_GEE_MEMORY_MAX = 20
 
def _asset_id_for_key(cache_key: str) -> str:
    """Build the full GEE asset path for a given cache key."""
    safe_key = hashlib.md5(cache_key.encode()).hexdigest()
    return f"{_GEE_ASSET_BASE}/rf_{safe_key}"
 
def _gee_asset_exists(asset_id: str) -> bool:
    """Check if a GEE asset exists without raising an exception."""
    try:
        info = ee.data.getAsset(asset_id)
        return info is not None
    except Exception:
        return False

def _train_rf_classifier(aoi: Any, baseline: Any) -> Any:
    """The core logic to train a Random Forest classifier using WorldCover 2021 labels."""
    worldcover = ee.Image("ESA/WorldCover/v200/2021").select("Map").clip(aoi)
    labels = worldcover.remap(
        [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
        [ 1,  2,  2,  3,  4,  5,  7,  6,  6,  2,  2]
    ).rename("label").toInt()

    input_bands = baseline.bandNames()
    all_samples = baseline.addBands(labels).updateMask(labels.neq(0)).stratifiedSample(
        numPoints=400,
        classBand="label",
        region=aoi,
        scale=50,
        seed=42,
        tileScale=4,
        geometries=False
    )

    return ee.Classifier.smileRandomForest(50, seed=42).train(
        features=all_samples,
        classProperty="label",
        inputProperties=input_bands
    )

def _evict_gee_memory_cache_if_full() -> None:
    """Evict the oldest entry from the GEE memory cache if at capacity."""
    if len(_gee_memory_cache) >= _GEE_MEMORY_MAX:
        oldest_key = next(iter(_gee_memory_cache))
        del _gee_memory_cache[oldest_key]
        logger.info("Evicted oldest classifier from GEE memory cache [key=%s]", oldest_key)

def _export_classifier_to_gee_asset(classifier: Any, cache_key: str, asset_id: str) -> None:
    """Start a GEE export task to save classifier as a permanent asset."""
    try:
        safe_desc = hashlib.md5(cache_key.encode()).hexdigest()[:16]
        task = ee.batch.Export.classifier.toAsset(
            classifier=classifier,
            description=f"bhoomi_rf_{safe_desc}",
            assetId=asset_id
        )
        task.start()
        logger.info("GEE asset export task started [asset=%s, task=%s]", asset_id, task.id)
    except Exception as exc:
        logger.warning("GEE asset export failed (non-fatal): %s", exc)

def get_or_train_classifier_gee_asset(aoi: Any, baseline: Any, cache_key: str) -> Any:
    """Return a trained RF classifier using GEE asset storage as cache."""
    asset_id = _asset_id_for_key(cache_key)
 
    if cache_key in _gee_memory_cache:
        logger.info("Classifier loaded from memory cache [key=%s]", cache_key)
        return _gee_memory_cache[cache_key]
 
    if _gee_asset_exists(asset_id):
        try:
            classifier = ee.Classifier.load(asset_id)
            logger.info("Classifier loaded from GEE asset [%s]", asset_id)
            _evict_gee_memory_cache_if_full()
            _gee_memory_cache[cache_key] = classifier
            return classifier
        except Exception as exc:
            logger.warning("GEE asset load failed, retraining [%s]: %s", asset_id, exc)
 
    logger.info("No GEE asset found, training RF classifier [key=%s]", cache_key)
    classifier = _train_rf_classifier(aoi, baseline)
    _export_classifier_to_gee_asset(classifier, cache_key, asset_id)
    _evict_gee_memory_cache_if_full()
    _gee_memory_cache[cache_key] = classifier
    return classifier



class AoiPayload(BaseModel):
    id: str
    name: str
    geometry: dict[str, Any]


class BaselinePayload(BaseModel):
    mode: str | None = None
    years: int | None = None
    lagYears: int | None = None


class ThresholdProfilePayload(BaseModel):
    id: str
    name: str
    mode: str
    config: dict[str, Any] | list[Any] | str | int | float | bool | None


class MonitoringRunRequest(BaseModel):
    runId: str
    userId: str
    runDateIso: str
    aoi: AoiPayload
    baseline: BaselinePayload
    thresholdProfile: ThresholdProfilePayload | None = None
    configOverrides: dict[str, float] | None = None


class MetricResult(BaseModel):
    threatType: str
    rawAreaKm2: float = 0
    filteredAreaKm2: float = 0
    percentOfAoi: float = 0
    triggered: bool = False
    severity: str | None = None


class AlertResult(BaseModel):
    threatType: str
    severity: str
    areaKm2: float = 0
    percentOfAoi: float = 0
    message: str | None = None


class ReportResult(BaseModel):
    summary: dict[str, Any]
    details: dict[str, Any] | None = None


class MonitoringRunResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: Literal["succeeded", "failed"] = "succeeded"
    errorMessage: str | None = None
    metrics: list[MetricResult] = Field(default_factory=list)
    alerts: list[AlertResult] = Field(default_factory=list)
    report: ReportResult | None = None


app = FastAPI(title="BhoomiRakshak Model Service", version="0.1.0")

THREAT_ORDER = [
    "deforestation",
    "vegLoss",
    "waterDeg",
    "urbanExp",
    "soilDeg",
    "agriLoss",
    "poaching",
]

LULC_CLASS_BY_NAME = {
    "forest": 1,
    "shrub": 2,
    "crop": 3,
    "urban": 4,
    "barren": 5,
    "water": 6,
    "snow": 7,
}

# Conservative demo defaults: no alerts unless configOverrides explicitly request simulation.
DEFAULT_ALERT_PCT = {
    "deforestation": 0.5,
    "vegLoss": 0.3,
    "waterDeg": 0.1,
    "urbanExp": 0.8,
    "soilDeg": 0.3,
    "agriLoss": 0.4,
    "poaching": 0.05,
}

DEFAULT_MODEL_NUMERIC_CONFIG = {
    "CLOUD_STRICT": 15,
    "CLOUD_RELAXED": 35,
    "BASELINE_YEARS": 5,
    "BASELINE_LAG_YEARS": 2,
    "FIXED_BASELINE_START_YEAR": 2018,
    "FIXED_BASELINE_END_YEAR": 2020,
    "SEASON_HALF_WINDOW_MONTHS": 1,
    "CURRENT_LOOKBACK_MONTHS": 3,
    "CURRENT_FORWARD_MONTHS": 1,
    "DW_MIN_CONFIDENCE": 0.6,
    "STATS_SCALE_DEFAULT": 20,
    "STATS_SCALE_WATER": 20,
    "STATS_SCALE_VEG": 20,
    "DEFOR_NDVI_FLOOR": 0.45,
    "DEFOR_EVI_FLOOR": 0.25,
    "DEFOR_DROP_HIGH": -0.10,
    "DEFOR_DROP_MEDIUM": -0.20,
    "VEG_NDVI_FLOOR": 0.35,
    "VEG_DROP_HIGH": -0.10,
    "VEG_DROP_MEDIUM": -0.18,
    "WATER_NDWI_FLOOR": 0.18,
    "WATER_DROP_HIGH": -0.08,
    "WATER_DROP_MEDIUM": -0.14,
    "URBAN_NDBI_HIGH": 0.08,
    "URBAN_NDBI_MEDIUM": 0.14,
    "SOIL_BSI_HIGH": 0.06,
    "SOIL_BSI_MEDIUM": 0.15,
    "AGRI_NDVI_DROP": -0.10,
    "POACH_LIGHT_RISE": 5.0,
    "POACH_NDVI_DROP": -0.15,
    "CLEAN_DEFOR_MIN_FRAC": 0.40,
    "CLEAN_VEG_MIN_FRAC": 0.40,
    "CLEAN_URBAN_MIN_FRAC": 0.35,
    "CLEAN_SOIL_MIN_FRAC": 0.42,
    "CLEAN_AGRI_MIN_FRAC": 0.40,
    "CLEAN_POACH_MIN_FRAC": 0.55,
    "ALERT_DEFOR": 5.0,
    "ALERT_URBAN": 10.0,
    "ALERT_WATER": 1.0,
    "ALERT_AGRI": 8.0,
    "ALERT_POACH": 1.0,
    "ALERT_SOIL": 5.0,
    "ALERT_VEG": 8.0,
    "ALERT_DEFOR_PCT": 0.5,
    "ALERT_VEG_PCT": 0.4,
    "ALERT_WATER_PCT": 0.045,
    "ALERT_URBAN_PCT": 0.8,
    "ALERT_SOIL_PCT": 0.3,
    "ALERT_AGRI_PCT": 0.4,
    "ALERT_POACH_PCT": 0.05,
}

OVERRIDE_ALIASES = {
    "deforestationAreaKm2": "ALERT_DEFOR",
    "deforestationPct": "ALERT_DEFOR_PCT",
    "vegLossAreaKm2": "ALERT_VEG",
    "vegLossPct": "ALERT_VEG_PCT",
    "waterDegAreaKm2": "ALERT_WATER",
    "waterDegPct": "ALERT_WATER_PCT",
    "urbanExpAreaKm2": "ALERT_URBAN",
    "urbanExpPct": "ALERT_URBAN_PCT",
    "soilDegAreaKm2": "ALERT_SOIL",
    "soilDegPct": "ALERT_SOIL_PCT",
    "agriLossAreaKm2": "ALERT_AGRI",
    "agriLossPct": "ALERT_AGRI_PCT",
    "poachingAreaKm2": "ALERT_POACH",
    "poachingPct": "ALERT_POACH_PCT",
    "baselineYears": "BASELINE_YEARS",
    "baselineLagYears": "BASELINE_LAG_YEARS",
    "fixedBaselineStartYear": "FIXED_BASELINE_START_YEAR",
    "fixedBaselineEndYear": "FIXED_BASELINE_END_YEAR",
    "dwMinConfidence": "DW_MIN_CONFIDENCE",
    "statsScaleDefault": "STATS_SCALE_DEFAULT",
    "statsScaleWater": "STATS_SCALE_WATER",
    "statsScaleVeg": "STATS_SCALE_VEG",
}

ABS_ALERT_KEY_BY_THREAT = {
    "deforestation": "ALERT_DEFOR",
    "vegLoss": "ALERT_VEG",
    "waterDeg": "ALERT_WATER",
    "urbanExp": "ALERT_URBAN",
    "soilDeg": "ALERT_SOIL",
    "agriLoss": "ALERT_AGRI",
    "poaching": "ALERT_POACH",
}

PCT_ALERT_KEY_BY_THREAT = {
    "deforestation": "ALERT_DEFOR_PCT",
    "vegLoss": "ALERT_VEG_PCT",
    "waterDeg": "ALERT_WATER_PCT",
    "urbanExp": "ALERT_URBAN_PCT",
    "soilDeg": "ALERT_SOIL_PCT",
    "agriLoss": "ALERT_AGRI_PCT",
    "poaching": "ALERT_POACH_PCT",
}

_ee_init_attempted = False
_ee_init_ok = False
_ee_init_error = "earthengine-api not installed"


@dataclass
class DynamicWorldArtifacts:
    cls: Any
    conf: Any
    obs_count: Any


def _polygon_area_km2(coords: list[list[float]]) -> float:
    """Approximate polygon area in km2 from lon/lat ring using local planar conversion."""
    if len(coords) < 4:
        return 0.0

    lat_ref = sum(p[1] for p in coords) / len(coords)
    cos_lat = math.cos(math.radians(lat_ref))
    if abs(cos_lat) < 1e-6:
        cos_lat = 1e-6

    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * cos_lat

    area = 0.0
    for i in range(len(coords) - 1):
        x1 = coords[i][0] * km_per_deg_lon
        y1 = coords[i][1] * km_per_deg_lat
        x2 = coords[i + 1][0] * km_per_deg_lon
        y2 = coords[i + 1][1] * km_per_deg_lat
        area += x1 * y2 - x2 * y1

    return abs(area) * 0.5


def _geometry_area_km2(geometry: dict[str, Any]) -> float:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")

    if gtype == "Polygon" and isinstance(coords, list) and coords:
        outer = coords[0]
        if isinstance(outer, list):
            outer_area = _polygon_area_km2(outer)
        else:
            outer_area = 0.0

        holes_area = 0.0
        for ring in coords[1:]:
            if isinstance(ring, list):
                holes_area += _polygon_area_km2(ring)

        return max(0.0, outer_area - holes_area)

    if gtype == "MultiPolygon" and isinstance(coords, list):
        total = 0.0
        for poly in coords:
            if isinstance(poly, list) and poly:
                total += _geometry_area_km2({"type": "Polygon", "coordinates": poly})
        return total

    return 0.0


def _severity_from_pct(percent: float) -> str:
    if percent >= 2.0:
        return "high"
    if percent >= 1.0:
        return "medium"
    return "low"


def _override_value(overrides: dict[str, float], names: list[str]) -> float | None:
    for n in names:
        v = overrides.get(n)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def _safe_number(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def _safe_int(value: Any, fallback: int) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    return fallback


def _extract_numeric_config(raw: Any) -> dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    result: dict[str, float] = {}
    for key, value in raw.items():
        if isinstance(value, (int, float)):
            result[str(key)] = float(value)
    return result


def _collect_numeric_overrides(payload: MonitoringRunRequest) -> dict[str, float]:
    profile_config = payload.thresholdProfile.config if payload.thresholdProfile else None
    merged = _extract_numeric_config(profile_config)
    if payload.configOverrides:
        merged.update(payload.configOverrides)
    return merged


def _normalized_engine_mode() -> Literal["auto", "dynamic_world", "simulation"]:
    mode = (os.getenv("MODEL_ENGINE") or "auto").strip().lower()
    if mode in {"dynamic_world", "simulation", "auto"}:
        return mode  # type: ignore[return-value]
    return "auto"


def _resolve_run_date(run_date_iso: str) -> datetime:
    try:
        return datetime.fromisoformat(run_date_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _resolve_model_config(payload: MonitoringRunRequest, overrides: dict[str, float]) -> dict[str, float]:
    config = dict(DEFAULT_MODEL_NUMERIC_CONFIG)

    if payload.baseline.years is not None:
        config["BASELINE_YEARS"] = float(payload.baseline.years)
    if payload.baseline.lagYears is not None:
        config["BASELINE_LAG_YEARS"] = float(payload.baseline.lagYears)

    for key, value in overrides.items():
        target_key = OVERRIDE_ALIASES.get(key, key)
        if target_key in config:
            config[target_key] = float(value)

    return config


def _severity_from_alert_threshold(area_km2: float, threshold_km2: float) -> str:
    if threshold_km2 <= 0:
        return "medium"
    if area_km2 > threshold_km2 * 3:
        return "high"
    if area_km2 > threshold_km2 * 2:
        return "medium"
    return "low"


def _initialize_ee() -> tuple[bool, str | None]:
    global _ee_init_attempted, _ee_init_ok, _ee_init_error

    if _ee_init_attempted:
        return _ee_init_ok, _ee_init_error

    _ee_init_attempted = True
    if ee is None:
        _ee_init_ok = False
        _ee_init_error = "earthengine-api dependency unavailable"
        return _ee_init_ok, _ee_init_error

    try:
        service_account = os.getenv("EE_SERVICE_ACCOUNT")
        key_path = os.getenv("EE_PRIVATE_KEY_PATH") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        project = os.getenv("EE_PROJECT")

        if service_account and key_path:
            credentials = ee.ServiceAccountCredentials(service_account, key_path)
            if project:
                ee.Initialize(credentials=credentials, project=project)
            else:
                ee.Initialize(credentials=credentials)
        else:
            if project:
                ee.Initialize(project=project)
            else:
                ee.Initialize()

        _ee_init_ok = True
        _ee_init_error = None
    except Exception as exc:
        _ee_init_ok = False
        _ee_init_error = str(exc)

    return _ee_init_ok, _ee_init_error


def _map_dw_label_to_bhoomi(dw_label_image: Any) -> Any:
    return dw_label_image.remap([0, 1, 2, 3, 4, 5, 6, 7, 8], [6, 1, 2, 2, 3, 2, 4, 5, 7]).toInt()


def _mask_s2_clouds(image: Any) -> Any:
    scl = image.select("SCL")
    mask = (
        scl.neq(1)
        .And(scl.neq(3))
        .And(scl.neq(7))
        .And(scl.neq(8))
        .And(scl.neq(9))
        .And(scl.neq(10))
    )
    return image.updateMask(mask).divide(10000).copyProperties(image, ["system:time_start"])


def _run_simulation(payload: MonitoringRunRequest, overrides: dict[str, float], reason: str | None = None) -> MonitoringRunResponse:
    aoi_area_km2 = _geometry_area_km2(payload.aoi.geometry)

    metrics: list[MetricResult] = []
    alerts: list[AlertResult] = []

    for threat in THREAT_ORDER:
        area_override = _override_value(overrides, [f"{threat}AreaKm2", f"{threat}_area_km2"])
        pct_override = _override_value(overrides, [f"{threat}Pct", f"{threat}_pct"])

        area_km2 = 0.0
        percent = 0.0

        if pct_override is not None and aoi_area_km2 > 0:
            percent = max(0.0, pct_override)
            area_km2 = (percent / 100.0) * aoi_area_km2

        if area_override is not None:
            area_km2 = max(area_km2, area_override)
            if aoi_area_km2 > 0:
                percent = max(percent, (area_km2 / aoi_area_km2) * 100.0)

        trigger_pct = DEFAULT_ALERT_PCT.get(threat, 0.5)
        triggered = percent >= trigger_pct and area_km2 > 0
        severity = _severity_from_pct(percent) if triggered else None

        metric = MetricResult(
            threatType=threat,
            rawAreaKm2=round(area_km2, 6),
            filteredAreaKm2=round(area_km2, 6),
            percentOfAoi=round(percent, 6),
            triggered=triggered,
            severity=severity,
        )
        metrics.append(metric)

        if triggered and severity is not None:
            alerts.append(
                AlertResult(
                    threatType=threat,
                    severity=severity,
                    areaKm2=metric.filteredAreaKm2,
                    percentOfAoi=metric.percentOfAoi,
                    message=f"{threat} crossed configured threshold",
                )
            )

    now_iso = datetime.now(timezone.utc).isoformat()
    details = {
        "baseline": payload.baseline.model_dump(),
        "thresholdProfile": payload.thresholdProfile.model_dump() if payload.thresholdProfile else None,
        "configOverrideKeys": sorted(list(overrides.keys())),
        "mode": "simulation",
    }
    if reason:
        details["fallbackReason"] = reason

    report = ReportResult(
        summary={
            "engine": "python-fastapi-simulation",
            "runId": payload.runId,
            "processedAt": now_iso,
            "aoiAreaKm2": round(aoi_area_km2, 6),
            "metricCount": len(metrics),
            "alertCount": len(alerts),
        },
        details=details,
    )

    return MonitoringRunResponse(
        status="succeeded",
        metrics=metrics,
        alerts=alerts,
        report=report,
    )


def _run_dynamic_world(payload: MonitoringRunRequest, overrides: dict[str, float]) -> MonitoringRunResponse:
    ready, init_error = _initialize_ee()
    if not ready:
        raise RuntimeError(f"earth engine init failed: {init_error}")

    run_date = _resolve_run_date(payload.runDateIso)
    current_year_int = run_date.year
    current_month_int = run_date.month
    config = _resolve_model_config(payload, overrides)
    baseline_mode = (payload.baseline.mode or "rolling").strip().lower()
    if baseline_mode not in {"rolling", "fixed"}:
        baseline_mode = "rolling"

    aoi = ee.Geometry(payload.aoi.geometry)

    current_year = ee.Number(current_year_int)
    current_month = ee.Number(current_month_int)

    if baseline_mode == "fixed":
        baseline_end_year = ee.Number(_safe_int(config.get("FIXED_BASELINE_END_YEAR"), 2020))
        baseline_start_year = ee.Number(_safe_int(config.get("FIXED_BASELINE_START_YEAR"), 2018))
    else:
        baseline_end_year = current_year.subtract(_safe_int(config.get("BASELINE_LAG_YEARS"), 2))
        baseline_start_year = baseline_end_year.subtract(_safe_int(config.get("BASELINE_YEARS"), 5) - 1)

    baseline_start_date = ee.Date.fromYMD(baseline_start_year, 1, 1)
    baseline_end_date_exclusive = ee.Date.fromYMD(baseline_end_year.add(1), 1, 1)

    def get_sar_composite(start_date: Any, end_date: Any) -> Any:
        collection = (
            ee.ImageCollection("COPERNICUS/S1_GRD")
            .filterBounds(aoi)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
            .filter(ee.Filter.eq("instrumentMode", "IW"))
            .select(["VV", "VH"])
        )

        empty = ee.Image.constant([0, 0]).rename(["VV", "VH"]).clip(aoi)
        composite = ee.Image(ee.Algorithms.If(collection.size().gte(1), collection.median().clip(aoi), empty))
        # Reuse the already built composite and derive ratio from VV/VH bands (no extra S1 re-query).
        vv = composite.select("VV")
        vh = composite.select("VH")
        ratio = vv.subtract(vh).rename("VV_VH_ratio")
        return composite.addBands(ratio)

    def get_optical_composite(year: Any, month: Any) -> Any:
        half_window = _safe_int(config.get("SEASON_HALF_WINDOW_MONTHS"), 1)
        start_date = ee.Date.fromYMD(year, month, 1).advance(-half_window, "month")
        end_date = ee.Date.fromYMD(year, month, 1).advance(half_window + 1, "month")

        strict = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", _safe_number(config.get("CLOUD_STRICT"))))
            .map(_mask_s2_clouds)
        )

        relaxed = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", _safe_number(config.get("CLOUD_RELAXED"))))
            .map(_mask_s2_clouds)
        )

        fallback = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi)
            .filterDate(ee.Date.fromYMD(year, 1, 1), ee.Date.fromYMD(year, 12, 31))
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", _safe_number(config.get("CLOUD_RELAXED"))))
            .map(_mask_s2_clouds)
        )

        chosen = ee.ImageCollection(
            ee.Algorithms.If(
                strict.size().gte(3),
                strict,
                ee.Algorithms.If(relaxed.size().gte(1), relaxed, fallback),
            )
        )

        empty = ee.Image.constant([0, 0, 0, 0, 0, 0]).rename(["B2", "B3", "B4", "B8", "B11", "B12"]).clip(aoi)
        c = ee.Image(ee.Algorithms.If(chosen.size().gte(1), chosen.median().clip(aoi), empty))

        ndvi = c.normalizedDifference(["B8", "B4"]).rename("NDVI")
        ndwi = c.normalizedDifference(["B3", "B11"]).rename("NDWI")
        ndbi = c.normalizedDifference(["B11", "B8"]).rename("NDBI")
        ndmi = c.normalizedDifference(["B8", "B11"]).rename("NDMI")
        bsi = (
            c.expression(
                "((SWIR+RED)-(NIR+BLUE))/((SWIR+RED)+(NIR+BLUE))",
                {"SWIR": c.select("B11"), "RED": c.select("B4"), "NIR": c.select("B8"), "BLUE": c.select("B2")},
            )
            .rename("BSI")
        )
        evi = (
            c.expression(
                "2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))",
                {"NIR": c.select("B8"), "RED": c.select("B4"), "BLUE": c.select("B2")},
            )
            .rename("EVI")
        )

        return c.select(["B2", "B3", "B4", "B8", "B11", "B12"]).addBands([ndvi, ndwi, ndbi, ndmi, bsi, evi])

    def get_dw_collection_with_fallback(start_date: Any, end_date: Any) -> Any:
        half_window = _safe_int(config.get("SEASON_HALF_WINDOW_MONTHS"), 1)
        start_month = current_month.subtract(half_window)
        end_month = current_month.add(half_window)

        primary = (
            ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
            .filterBounds(aoi)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.calendarRange(start_month, end_month, "month"))
        )
        fallback = (
            ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
            .filterBounds(aoi)
            .filterDate(ee.Date(end_date).advance(-12, "month"), end_date)
            .filter(ee.Filter.calendarRange(start_month, end_month, "month"))
        )
        return ee.ImageCollection(ee.Algorithms.If(primary.size().gte(1), primary, fallback))

    def get_dynamic_world_class_composite(start_date: Any, end_date: Any, rf_image: Any, classifier: Any) -> DynamicWorldArtifacts:
        dw = get_dw_collection_with_fallback(start_date, end_date)
        prob_bands = [
            "water",
            "trees",
            "grass",    
            "flooded_vegetation",
            "crops",
            "shrub_and_scrub",
            "built",
            "bare",
            "snow_and_ice",
        ]

        def _smooth_prob(img: Any) -> Any:
            image = ee.Image(img)
            return image.select(prob_bands).focal_mean(1, "square", "pixels")

        has_obs = dw.size().gte(1)
        
        prob_smoothed = ee.ImageCollection(
            ee.Algorithms.If(
                has_obs, 
                dw.map(_smooth_prob), 
                ee.ImageCollection([ee.Image.constant(0).rename(prob_bands)])
            )
        ).mean()

        argmax_idx = prob_smoothed.toArray().arrayArgmax().arrayGet([0])
        max_prob = prob_smoothed.reduce(ee.Reducer.max()).rename("dw_conf_mean")
        cls_raw = _map_dw_label_to_bhoomi(argmax_idx).rename("cls")

        # Fallback to Random Forest (V2 fusion)
        fallback_cls = rf_image.classify(classifier).focal_mode(1, "square", "pixels").rename("cls").toInt().clip(aoi)
        fallback_conf = ee.Image.constant(0).rename("dw_conf_mean").clip(aoi)

        final_cls_no_mask = ee.Image(ee.Algorithms.If(has_obs, cls_raw, fallback_cls))
        final_max_prob = ee.Image(ee.Algorithms.If(has_obs, max_prob, fallback_conf)).clip(aoi)

        high_conf_mask = final_max_prob.gte(_safe_number(config.get("DW_MIN_CONFIDENCE")))
        cls = fallback_cls.where(high_conf_mask, final_cls_no_mask).clip(aoi)

        return DynamicWorldArtifacts(cls=cls, conf=final_max_prob, obs_count=dw.size())

    baseline_year_list = ee.List.sequence(baseline_start_year, baseline_end_year)

    def _map_year_to_baseline(y: Any) -> Any:
        return get_optical_composite(ee.Number(y), current_month)

    baseline_optical = ee.ImageCollection.fromImages(baseline_year_list.map(_map_year_to_baseline)).median().clip(aoi)
    current_optical = get_optical_composite(current_year, current_month)

    dem = ee.Image("USGS/SRTMGL1_003").clip(aoi).rename("elevation")
    slope = ee.Terrain.slope(dem).clip(aoi).rename("slope")
    aspect = ee.Terrain.aspect(dem).clip(aoi).rename("aspect")
    terrain = dem.addBands([slope, aspect])

    sar_baseline = get_sar_composite(baseline_start_date, baseline_end_date_exclusive)
    sar_current_start = ee.Date.fromYMD(current_year, current_month, 1).advance(-_safe_int(config.get("CURRENT_LOOKBACK_MONTHS"), 3), "month")
    sar_current_end = ee.Date.fromYMD(current_year, current_month, 1).advance(_safe_int(config.get("CURRENT_FORWARD_MONTHS"), 1), "month")
    sar_current = get_sar_composite(sar_current_start, sar_current_end)

    baseline = baseline_optical.addBands(terrain).addBands(sar_baseline)
    current = current_optical.addBands(terrain).addBands(sar_current)

    # ── V2: Train Random Forest using ESA WorldCover 2021 (with GEE Asset Caching) ──
    cache_key = f"{payload.aoi.id}_{baseline_mode}_{current_year_int}"
    rf_classifier = get_or_train_classifier_gee_asset(aoi, baseline, cache_key)
    # ───────────────────────────────────────────────────────

    dw_baseline = get_dynamic_world_class_composite(baseline_start_date, baseline_end_date_exclusive, baseline, rf_classifier)
    dw_current_start = ee.Date.fromYMD(current_year, current_month, 1).advance(-_safe_int(config.get("CURRENT_LOOKBACK_MONTHS"), 3), "month")
    dw_current_end = ee.Date.fromYMD(current_year, current_month, 1).advance(_safe_int(config.get("CURRENT_FORWARD_MONTHS"), 1), "month")
    dw_current = get_dynamic_world_class_composite(dw_current_start, dw_current_end, current, rf_classifier)

    cls_baseline = dw_baseline.cls.focal_mode(1, "square", "pixels")
    cls_current = dw_current.cls.focal_mode(1, "square", "pixels")

    ndvi_delta = current.select("NDVI").subtract(baseline.select("NDVI"))
    ndwi_delta = current.select("NDWI").subtract(baseline.select("NDWI"))
    ndbi_delta = current.select("NDBI").subtract(baseline.select("NDBI"))
    bsi_delta = current.select("BSI").subtract(baseline.select("BSI"))
    evi_delta = current.select("EVI").subtract(baseline.select("EVI"))

    def apply_density_cleanup(mask: Any, kernel: Any, min_fraction: float) -> Any:
        m = mask.selfMask()
        density = m.unmask(0).reduceNeighborhood(reducer=ee.Reducer.mean(), kernel=kernel)
        return m.updateMask(density.gte(min_fraction)).selfMask()

    night_now_coll = (
        ee.ImageCollection("NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG")
        .filterDate(
            ee.Date.fromYMD(current_year, current_month, 1).advance(-_safe_int(config.get("CURRENT_LOOKBACK_MONTHS"), 3), "month"),
            ee.Date.fromYMD(current_year, current_month, 1).advance(_safe_int(config.get("CURRENT_FORWARD_MONTHS"), 1), "month"),
        )
    )
    night_base_coll = ee.ImageCollection("NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG").filterDate(baseline_start_date, baseline_end_date_exclusive)
    night_fallback = ee.Image.constant(0).rename("avg_rad")
    night_lights_now = ee.Image(ee.Algorithms.If(night_now_coll.size().gte(1), night_now_coll.mean().select("avg_rad"), night_fallback)).clip(aoi)
    night_lights_base = ee.Image(ee.Algorithms.If(night_base_coll.size().gte(1), night_base_coll.mean().select("avg_rad"), night_fallback)).clip(aoi)
    light_increase = night_lights_now.subtract(night_lights_base)

    was_forest = baseline.select("NDVI").gt(_safe_number(config.get("DEFOR_NDVI_FLOOR"))).And(
        baseline.select("EVI").gt(_safe_number(config.get("DEFOR_EVI_FLOOR")))
    )
    class_flip_forest = cls_baseline.eq(1).And(cls_current.neq(1))
    defor_high = was_forest.And(class_flip_forest).And(ndvi_delta.lt(_safe_number(config.get("DEFOR_DROP_HIGH"))))
    defor_medium = (
        was_forest.And(defor_high.Not())
        .And(ndvi_delta.lt(_safe_number(config.get("DEFOR_DROP_MEDIUM"))))
        .And(evi_delta.lt(-0.10))
    )
    deforestation_raw = defor_high.Or(defor_medium)

    was_veg = baseline.select("NDVI").gt(_safe_number(config.get("VEG_NDVI_FLOOR"))).And(was_forest.Not())
    veg_high = was_veg.And(cls_baseline.lte(3)).And(cls_current.gte(4)).And(ndvi_delta.lt(_safe_number(config.get("VEG_DROP_HIGH"))))
    veg_medium = was_veg.And(veg_high.Not()).And(ndvi_delta.lt(_safe_number(config.get("VEG_DROP_MEDIUM"))))
    veg_loss_raw = veg_high.Or(veg_medium)

    was_water = baseline.select("NDWI").gt(_safe_number(config.get("WATER_NDWI_FLOOR"))).And(baseline.select("NDVI").lt(0.20))
    class_flip_water = cls_baseline.eq(6).And(cls_current.neq(6))
    water_high = was_water.And(class_flip_water).And(ndwi_delta.lt(_safe_number(config.get("WATER_DROP_HIGH"))))
    water_medium = was_water.And(water_high.Not()).And(ndwi_delta.lt(_safe_number(config.get("WATER_DROP_MEDIUM"))))
    water_deg_raw = water_high.Or(water_medium)

    class_flip_urban = cls_baseline.neq(4).And(cls_current.eq(4))
    urban_high = class_flip_urban.And(ndbi_delta.gt(_safe_number(config.get("URBAN_NDBI_HIGH")))).And(ndvi_delta.lt(-0.03))
    urban_medium = urban_high.Not().And(ndbi_delta.gt(_safe_number(config.get("URBAN_NDBI_MEDIUM")))).And(ndvi_delta.lt(-0.08))
    urban_exp_raw = urban_high.Or(urban_medium)

    class_flip_soil = cls_baseline.neq(5).And(cls_current.eq(5))
    soil_high = class_flip_soil.And(bsi_delta.gt(_safe_number(config.get("SOIL_BSI_HIGH"))))
    soil_medium = (
        soil_high.Not()
        .And(bsi_delta.gt(_safe_number(config.get("SOIL_BSI_MEDIUM"))))
        .And(ndvi_delta.lt(-0.10))
        .And(cls_current.neq(4))
        .And(cls_current.neq(6))
    )
    soil_deg_raw = soil_high.Or(soil_medium)

    agri_loss_raw = cls_baseline.eq(3).And(cls_current.eq(4).Or(cls_current.eq(5))).And(ndvi_delta.lt(_safe_number(config.get("AGRI_NDVI_DROP"))))

    light_anomalous = light_increase.gt(_safe_number(config.get("POACH_LIGHT_RISE")))
    is_forest = cls_current.eq(1)
    forest_interior = is_forest.focal_min(radius=2, kernelType="square", units="pixels")
    forest_edge = is_forest.And(forest_interior.Not())
    forest_loss_zone = cls_baseline.eq(1).And(cls_current.neq(1))

    poaching_raw = (
        light_anomalous.And(forest_loss_zone.Or(forest_edge))
        .And(ndvi_delta.lt(_safe_number(config.get("POACH_NDVI_DROP"))))
        .And(cls_current.neq(4))
        .And(dem.gt(300))
    )

    clean = {
        "deforestation": apply_density_cleanup(deforestation_raw, ee.Kernel.square(1), _safe_number(config.get("CLEAN_DEFOR_MIN_FRAC"))),
        "vegLoss": apply_density_cleanup(veg_loss_raw, ee.Kernel.plus(1), _safe_number(config.get("CLEAN_VEG_MIN_FRAC"))),
        "waterDeg": water_deg_raw.selfMask(),
        "urbanExp": apply_density_cleanup(urban_exp_raw, ee.Kernel.square(1), _safe_number(config.get("CLEAN_URBAN_MIN_FRAC"))),
        "soilDeg": apply_density_cleanup(soil_deg_raw, ee.Kernel.plus(1), _safe_number(config.get("CLEAN_SOIL_MIN_FRAC"))),
        "agriLoss": apply_density_cleanup(agri_loss_raw, ee.Kernel.plus(1), _safe_number(config.get("CLEAN_AGRI_MIN_FRAC"))),
        "poaching": apply_density_cleanup(poaching_raw, ee.Kernel.square(1), _safe_number(config.get("CLEAN_POACH_MIN_FRAC"))),
    }

    raw = ee.Image.cat(
        [
            deforestation_raw.rename("deforestation"),
            veg_loss_raw.rename("vegLoss"),
            water_deg_raw.rename("waterDeg"),
            urban_exp_raw.rename("urbanExp"),
            soil_deg_raw.rename("soilDeg"),
            agri_loss_raw.rename("agriLoss"),
            poaching_raw.rename("poaching"),
        ]
    ).clip(aoi)

    stats_scale_default = _safe_number(config.get("STATS_SCALE_DEFAULT"))
    stats_scale_water = _safe_number(config.get("STATS_SCALE_WATER"))
    stats_scale_veg = _safe_number(config.get("STATS_SCALE_VEG"))
    
    # We combine everything into one big image stack for a single pass
    area_img = ee.Image.pixelArea().divide(1e6)
    
    # 1. Prepare Threat Stack
    clean_stack = ee.Image([clean[t].rename(t + "Filtered") for t in THREAT_ORDER])
    raw_stack = raw.rename([t + "Raw" for t in THREAT_ORDER])
    
    # 2. Combine all into one master stack (Removed fragile pixel_count)
    master_stack = ee.Image([
        area_img.rename("aoi_area")
    ]).addBands(raw_stack.multiply(area_img)) \
      .addBands(clean_stack.multiply(area_img))

    batch_stats = master_stack.reduceRegion(
        reducer=ee.Reducer.sum(),
        geometry=aoi,
        scale=stats_scale_default,
        maxPixels=1e12,
        tileScale=16
    )

    # 3. Confidence Mean Reducer
    conf_stats = ee.Image([
        dw_baseline.conf.rename("conf_base"),
        dw_current.conf.rename("conf_curr")
    ]).reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=aoi,
        scale=stats_scale_default,
        maxPixels=1e12,
        tileScale=16
    )

    # 4. Water and Veg specific scales for AOI reference area
    aoi_water_stats = area_img.rename("aoi_area").reduceRegion(
        reducer=ee.Reducer.sum(), geometry=aoi, scale=stats_scale_water, maxPixels=1e12, tileScale=16
    )
    aoi_veg_stats = area_img.rename("aoi_area").reduceRegion(
        reducer=ee.Reducer.sum(), geometry=aoi, scale=stats_scale_veg, maxPixels=1e12, tileScale=16
    )

    # 5. LULC Area Histogram (Grouped Reducer)
    lulc_groups = area_img.addBands(cls_current).reduceRegion(
        reducer=ee.Reducer.sum().group(groupField=1, groupName="class"),
        geometry=aoi,
        scale=stats_scale_default,
        maxPixels=1e12,
        tileScale=16
    ).get("groups")

    # Combine results for one single getInfo() dictionary fetch
    stats = ee.Dictionary({
        "batch": batch_stats,
        "conf": conf_stats,
        "aoiWater": aoi_water_stats,
        "aoiVeg": aoi_veg_stats,
        "lulc": lulc_groups,
        "dwObsBaseline": dw_baseline.obs_count,
        "dwObsCurrent": dw_current.obs_count
    })



    def _get_info_with_timeout(ee_obj: Any, timeout_seconds: int = 300) -> Any:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(ee_obj.getInfo)
            try:
                return future.result(timeout=timeout_seconds)
            except concurrent.futures.TimeoutError:
                raise RuntimeError(f"GEE computation timed out after {timeout_seconds} seconds")

    full_result = cast(dict[str, Any], _get_info_with_timeout(stats))
    
    # Flatten results
    res_batch = full_result.get("batch", {})
    res_conf = full_result.get("conf", {})
    res_water = full_result.get("aoiWater", {})
    res_veg = full_result.get("aoiVeg", {})
    res_lulc_list = full_result.get("lulc", [])
    res_lulc = {str(item["class"]): item["sum"] for item in res_lulc_list}

    result = {
        "deforestationRawKm2": res_batch.get("deforestationRaw", 0),
        "vegLossRawKm2": res_batch.get("vegLossRaw", 0),
        "waterDegRawKm2": res_batch.get("waterDegRaw", 0),
        "urbanExpRawKm2": res_batch.get("urbanExpRaw", 0),
        "soilDegRawKm2": res_batch.get("soilDegRaw", 0),
        "agriLossRawKm2": res_batch.get("agriLossRaw", 0),
        "poachingRawKm2": res_batch.get("poachingRaw", 0),
        
        "deforestationFilteredKm2": res_batch.get("deforestationFiltered", 0),
        "vegLossFilteredKm2": res_batch.get("vegLossFiltered", 0),
        "waterDegFilteredKm2": res_batch.get("waterDegFiltered", 0),
        "urbanExpFilteredKm2": res_batch.get("urbanExpFiltered", 0),
        "soilDegFilteredKm2": res_batch.get("soilDegFiltered", 0),
        "agriLossFilteredKm2": res_batch.get("agriLossFiltered", 0),
        "poachingFilteredKm2": res_batch.get("poachingFiltered", 0),
        
        "aoiDefaultKm2": res_batch.get("aoi_area", 0),
        "aoiWaterKm2": res_water.get("aoi_area", 0),
        "aoiVegKm2": res_veg.get("aoi_area", 0),
        
        "dwObsBaseline": full_result.get("dwObsBaseline", 0),
        "dwObsCurrent": full_result.get("dwObsCurrent", 0),
        "dwMeanConfBaseline": res_conf.get("conf_base", 0),
        "dwMeanConfCurrent": res_conf.get("conf_curr", 0),
        
        "lulcForestKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["forest"]), 0),
        "lulcShrubKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["shrub"]), 0),
        "lulcCropKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["crop"]), 0),
        "lulcUrbanKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["urban"]), 0),
        "lulcBarrenKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["barren"]), 0),
        "lulcWaterKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["water"]), 0),
        "lulcSnowKm2": res_lulc.get(str(LULC_CLASS_BY_NAME["snow"]), 0),
    }


    area_key_map = {
        "deforestation": ("deforestationRawKm2", "deforestationFilteredKm2", "aoiDefaultKm2"),
        "vegLoss": ("vegLossRawKm2", "vegLossFilteredKm2", "aoiVegKm2"),
        "waterDeg": ("waterDegRawKm2", "waterDegFilteredKm2", "aoiWaterKm2"),
        "urbanExp": ("urbanExpRawKm2", "urbanExpFilteredKm2", "aoiDefaultKm2"),
        "soilDeg": ("soilDegRawKm2", "soilDegFilteredKm2", "aoiDefaultKm2"),
        "agriLoss": ("agriLossRawKm2", "agriLossFilteredKm2", "aoiDefaultKm2"),
        "poaching": ("poachingRawKm2", "poachingFilteredKm2", "aoiDefaultKm2"),
    }

    metrics: list[MetricResult] = []
    alerts: list[AlertResult] = []

    for threat in THREAT_ORDER:
        raw_key, filtered_key, denom_key = area_key_map[threat]
        raw_area = max(0.0, _safe_number(result.get(raw_key)))
        filtered_area = max(0.0, _safe_number(result.get(filtered_key)))
        aoi_denominator = max(0.0, _safe_number(result.get(denom_key)))
        percent = (filtered_area / aoi_denominator * 100.0) if aoi_denominator > 0 else 0.0

        alert_abs = _safe_number(config.get(ABS_ALERT_KEY_BY_THREAT[threat]))
        alert_pct = _safe_number(config.get(PCT_ALERT_KEY_BY_THREAT[threat]))
        triggered = filtered_area > alert_abs and percent > alert_pct
        severity = _severity_from_alert_threshold(filtered_area, alert_abs) if triggered else None

        metric = MetricResult(
            threatType=threat,
            rawAreaKm2=round(raw_area, 6),
            filteredAreaKm2=round(filtered_area, 6),
            percentOfAoi=round(percent, 6),
            triggered=triggered,
            severity=severity,
        )
        metrics.append(metric)

        if triggered and severity is not None:
            alerts.append(
                AlertResult(
                    threatType=threat,
                    severity=severity,
                    areaKm2=metric.filteredAreaKm2,
                    percentOfAoi=metric.percentOfAoi,
                    message=f"{threat} exceeded absolute and AOI-normalized thresholds",
                )
            )

    now_iso = datetime.now(timezone.utc).isoformat()
    lulc_area_km2 = {
        "forest": round(_safe_number(result.get("lulcForestKm2")), 6),
        "shrub": round(_safe_number(result.get("lulcShrubKm2")), 6),
        "crop": round(_safe_number(result.get("lulcCropKm2")), 6),
        "urban": round(_safe_number(result.get("lulcUrbanKm2")), 6),
        "barren": round(_safe_number(result.get("lulcBarrenKm2")), 6),
        "water": round(_safe_number(result.get("lulcWaterKm2")), 6),
        "snow": round(_safe_number(result.get("lulcSnowKm2")), 6),
    }

    report = ReportResult(
        summary={
            "engine": "dynamic-world-ee",
            "runId": payload.runId,
            "processedAt": now_iso,
            "aoiAreaKm2": round(_safe_number(result.get("aoiDefaultKm2")), 6),
            "metricCount": len(metrics),
            "alertCount": len(alerts),
            "baselineMode": baseline_mode,
            "runYear": current_year_int,
            "runMonth": current_month_int,
            "lulcAreaKm2": lulc_area_km2,
        },
        details={
            "baseline": payload.baseline.model_dump(),
            "thresholdProfile": payload.thresholdProfile.model_dump() if payload.thresholdProfile else None,
            "configOverrideKeys": sorted(list(overrides.keys())),
            "derivedConfig": {
                "BASELINE_YEARS": _safe_int(config.get("BASELINE_YEARS"), 5),
                "BASELINE_LAG_YEARS": _safe_int(config.get("BASELINE_LAG_YEARS"), 2),
                "DW_MIN_CONFIDENCE": _safe_number(config.get("DW_MIN_CONFIDENCE")),
            },
            "earthEngine": {
                "dwObsBaseline": _safe_int(result.get("dwObsBaseline"), 0),
                "dwObsCurrent": _safe_int(result.get("dwObsCurrent"), 0),
                "dwMeanConfBaseline": round(_safe_number(result.get("dwMeanConfBaseline")), 6),
                "dwMeanConfCurrent": round(_safe_number(result.get("dwMeanConfCurrent")), 6),
            },
            "lulcAreaKm2": lulc_area_km2,
        },
    )

    return MonitoringRunResponse(status="succeeded", metrics=metrics, alerts=alerts, report=report)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/monitoring/run", response_model=MonitoringRunResponse)
def run_monitoring(payload: MonitoringRunRequest) -> MonitoringRunResponse:
    debug_data = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "aoi": payload.aoi.name,
        "geometry": payload.aoi.geometry
    }
    # with open("model_debug.json", "w") as f:
    #     json.dump(debug_data, f)
    
    overrides = _collect_numeric_overrides(payload)
    mode = _normalized_engine_mode()

    if mode == "simulation":
        return _run_simulation(payload, overrides)

    if mode == "dynamic_world":
        try:
            return _run_dynamic_world(payload, overrides)
        except Exception as exc:
            return MonitoringRunResponse(status="failed", errorMessage=str(exc), metrics=[], alerts=[])

    try:
        return _run_dynamic_world(payload, overrides)
    except Exception as exc:
        return _run_simulation(payload, overrides, reason=f"dynamic world fallback: {exc}")
