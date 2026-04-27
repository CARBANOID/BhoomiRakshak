Python model-service scaffold for BhoomiRakshak monitoring runs.

Model execution modes

- MODEL_ENGINE=dynamic_world: force real Earth Engine Dynamic World inference (fails run if EE is not configured)
- MODEL_ENGINE=simulation: force local simulation mode using config overrides
- MODEL_ENGINE=auto (default): try real Dynamic World first, then fallback to simulation

Earth Engine setup

Use one of these options before starting the service:

1. Interactive/default Earth Engine auth already available on the host.
2. Service account credentials via env vars:
   - EE_SERVICE_ACCOUNT=<service-account-email>
   - EE_PRIVATE_KEY_PATH=<path-to-json-key>
   - EE_PROJECT=<gcp-project-id>

For user-auth based auth, set EE_PROJECT to a project where your principal has Earth Engine usage permission.

Notes

- In dynamic_world mode, the service computes threat metrics/alerts from Sentinel-2, Sentinel-1, Dynamic World, terrain, and night-lights composites.
- In auto mode, if Earth Engine init or runtime fails, response falls back to simulation and report details include fallbackReason.
- Dynamic World report output includes LULC area summaries (forest/shrub/crop/urban/barren/water/snow) in summary and details.

Run locally

1. Create virtual environment
   python -m venv .venv
2. Activate
   Windows PowerShell: .venv\Scripts\Activate.ps1
3. Install dependencies
   pip install -r requirements.txt
4. Start service
   uvicorn main:app --host 127.0.0.1 --port 8000 --reload

API

- GET /health
- POST /monitoring/run

Request contract

The backend queue sends:
- runId, userId, runDateIso
- aoi: id, name, geometry (GeoJSON Polygon or MultiPolygon)
- baseline: mode, years, lagYears
- thresholdProfile (nullable)
- configOverrides (nullable numeric map)

Simulation overrides

The endpoint can simulate metrics via configOverrides keys:
- deforestationAreaKm2, deforestationPct
- vegLossAreaKm2, vegLossPct
- waterDegAreaKm2, waterDegPct
- urbanExpAreaKm2, urbanExpPct
- soilDegAreaKm2, soilDegPct
- agriLossAreaKm2, agriLossPct
- poachingAreaKm2, poachingPct

If no overrides are provided, metrics return as zero and no alerts are emitted.
