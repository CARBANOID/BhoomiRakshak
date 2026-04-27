```js
// ================================================================
// BhoomiRakshak v7.7-dw - Dynamic World Classifier Edition
// ================================================================
// Key differences vs RF version:
// 1) Uses GOOGLE/DYNAMICWORLD/V1 labels directly (no Smile RF training)
// 2) Keeps the same threat logic, cleanup, and hybrid alerts
// 3) Adds Dynamic World confidence diagnostics
// ================================================================

var districts = ee.FeatureCollection('FAO/GAUL/2015/level2');
var aoi = districts
	.filter(ee.Filter.eq('ADM1_NAME', 'Uttarakhand'))
	.filter(ee.Filter.eq('ADM2_NAME', 'Dehra Dun'))
	.geometry();

Map.centerObject(aoi, 11);

// Set RUN_YEAR / RUN_MONTH to numbers (e.g. 2025, 8) for backtesting.
// Keep as null to use current date.
var RUN_YEAR = null;
var RUN_MONTH = null;

var now = ee.Date(Date.now());
var currentYear = RUN_YEAR ? ee.Number(RUN_YEAR) : now.get('year');
var currentMonth = RUN_MONTH ? ee.Number(RUN_MONTH) : now.get('month');

var CONFIG = {
	CLOUD_STRICT: 15,
	CLOUD_RELAXED: 35,

	// Baseline behavior:
	// rolling = dynamic baseline relative to RUN_YEAR/RUN_MONTH (or current date)
	// fixed   = static baseline window below
	
	BASELINE_MODE: 'rolling',
	BASELINE_YEARS: 5,
	BASELINE_LAG_YEARS: 2,
	FIXED_BASELINE_START_YEAR: 2018,
	FIXED_BASELINE_END_YEAR: 2020,

	// Temporal windows
	SEASON_HALF_WINDOW_MONTHS: 1,
	CURRENT_LOOKBACK_MONTHS: 3,
	CURRENT_FORWARD_MONTHS: 1,

	// Dynamic World confidence floor per observation [0,1]
	DW_MIN_CONFIDENCE: 0.5,

	// Stats scale
	STATS_SCALE_DEFAULT: 100,
	STATS_SCALE_WATER: 50,
	STATS_SCALE_VEG: 50,

	// Deforestation
	DEFOR_NDVI_FLOOR: 0.45,
	DEFOR_EVI_FLOOR: 0.25,
	DEFOR_DROP_HIGH: -0.10,
	DEFOR_DROP_MEDIUM: -0.20,

	// Vegetation loss
	VEG_NDVI_FLOOR: 0.35,
	VEG_DROP_HIGH: -0.10,
	VEG_DROP_MEDIUM: -0.18,

	// Water
	WATER_NDWI_FLOOR: 0.18,
	WATER_DROP_HIGH: -0.08,
	WATER_DROP_MEDIUM: -0.14,

	// Urban
	URBAN_NDBI_HIGH: 0.08,
	URBAN_NDBI_MEDIUM: 0.14,

	// Soil
	SOIL_BSI_HIGH: 0.06,
	SOIL_BSI_MEDIUM: 0.15,

	// Agriculture
	AGRI_NDVI_DROP: -0.10,

	// Poaching proxy
	POACH_LIGHT_RISE: 5.0,
	POACH_NDVI_DROP: -0.15,

	// Cleanup density gates
	CLEAN_DEFOR_MIN_FRAC: 0.40,
	CLEAN_VEG_MIN_FRAC: 0.40,
	CLEAN_URBAN_MIN_FRAC: 0.35,
	CLEAN_SOIL_MIN_FRAC: 0.42,
	CLEAN_AGRI_MIN_FRAC: 0.40,
	CLEAN_POACH_MIN_FRAC: 0.55,

	// Alerts (km2)
	ALERT_DEFOR: 5.0,
	ALERT_URBAN: 10.0,
	ALERT_WATER: 1.0,
	ALERT_AGRI: 8.0,
	ALERT_POACH: 1.0,
	ALERT_SOIL: 5.0,
	ALERT_VEG: 8.0,

	// Alerts (% of AOI)
	ALERT_DEFOR_PCT: 0.5,
	ALERT_VEG_PCT: 0.4,
	ALERT_WATER_PCT: 0.045,
	ALERT_URBAN_PCT: 0.8,
	ALERT_SOIL_PCT: 0.3,
	ALERT_AGRI_PCT: 0.4,
	ALERT_POACH_PCT: 0.05
    // Early warning profile example:
	// ALERT_DEFOR_PCT: 0.20,
	// ALERT_URBAN: 7.0,
	// ALERT_URBAN_PCT: 0.20,
	// ALERT_VEG: 5.0,
	// ALERT_VEG_PCT: 0.15,
	// ALERT_WATER: 0.5,
	// ALERT_WATER_PCT: 0.015,
};

var baselineEndYear = CONFIG.BASELINE_MODE === 'fixed'
	? ee.Number(CONFIG.FIXED_BASELINE_END_YEAR)
	: ee.Number(currentYear).subtract(CONFIG.BASELINE_LAG_YEARS);

var baselineStartYear = CONFIG.BASELINE_MODE === 'fixed'
	? ee.Number(CONFIG.FIXED_BASELINE_START_YEAR)
	: baselineEndYear.subtract(CONFIG.BASELINE_YEARS - 1);

var baselineStartDate = ee.Date.fromYMD(baselineStartYear, 1, 1);
var baselineEndDateExclusive = ee.Date.fromYMD(baselineEndYear.add(1), 1, 1);

// Terrain
var dem = ee.Image('USGS/SRTMGL1_003').clip(aoi).rename('elevation');
var slope = ee.Terrain.slope(dem).clip(aoi).rename('slope');
var aspect = ee.Terrain.aspect(dem).clip(aoi).rename('aspect');
var terrain = dem.addBands([slope, aspect]);

// SAR
var sarBaseline = ee.ImageCollection('COPERNICUS/S1_GRD')
	.filterBounds(aoi)
	.filterDate(baselineStartDate, baselineEndDateExclusive)
	.filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
	.filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
	.filter(ee.Filter.eq('instrumentMode', 'IW'))
	.select(['VV', 'VH'])
	.median()
	.clip(aoi);

var sarCurrentStart = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(-CONFIG.CURRENT_LOOKBACK_MONTHS, 'month');
var sarCurrentEnd = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(CONFIG.CURRENT_FORWARD_MONTHS, 'month');

var sarCurrent = ee.ImageCollection('COPERNICUS/S1_GRD')
	.filterBounds(aoi)
	.filterDate(sarCurrentStart, sarCurrentEnd)
	.filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
	.filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
	.filter(ee.Filter.eq('instrumentMode', 'IW'))
	.select(['VV', 'VH'])
	.median()
	.clip(aoi);

var sarBaselineR = sarBaseline
	.addBands(sarBaseline.select('VV').subtract(sarBaseline.select('VH')).rename('VV_VH_ratio'));
var sarCurrentR = sarCurrent
	.addBands(sarCurrent.select('VV').subtract(sarCurrent.select('VH')).rename('VV_VH_ratio'));

// Optical preprocessing
function maskS2Clouds(img) {
	var scl = img.select('SCL');
	return img
		.updateMask(
			scl.neq(1)
				.and(scl.neq(3))
				.and(scl.neq(7))
				.and(scl.neq(8))
				.and(scl.neq(9))
				.and(scl.neq(10))
		)
		.divide(10000)
		.copyProperties(img, ['system:time_start']);
}

function getOpticalComposite(year, month) {
	year = ee.Number(year);
	month = ee.Number(month);

	var startDate = ee.Date.fromYMD(year, month, 1).advance(-CONFIG.SEASON_HALF_WINDOW_MONTHS, 'month');
	var endDate = ee.Date.fromYMD(year, month, 1).advance(CONFIG.SEASON_HALF_WINDOW_MONTHS + 1, 'month');

	var strict = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
		.filterBounds(aoi)
		.filterDate(startDate, endDate)
		.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.CLOUD_STRICT))
		.map(maskS2Clouds);

	var relaxed = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
		.filterBounds(aoi)
		.filterDate(startDate, endDate)
		.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.CLOUD_RELAXED))
		.map(maskS2Clouds);

	var fallback = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
		.filterBounds(aoi)
		.filterDate(ee.Date.fromYMD(year, 1, 1), ee.Date.fromYMD(year, 12, 31))
		.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.CLOUD_RELAXED))
		.map(maskS2Clouds);

	var chosen = ee.Algorithms.If(
		strict.size().gte(3),
		strict,
		ee.Algorithms.If(relaxed.size().gte(1), relaxed, fallback)
	);

	var c = ee.ImageCollection(chosen).median().clip(aoi);

	var ndvi = c.normalizedDifference(['B8', 'B4']).rename('NDVI');
	var ndwi = c.normalizedDifference(['B3', 'B11']).rename('NDWI');
	var ndbi = c.normalizedDifference(['B11', 'B8']).rename('NDBI');
	var ndmi = c.normalizedDifference(['B8', 'B11']).rename('NDMI');

	var bsi = c
		.expression('((SWIR+RED)-(NIR+BLUE))/((SWIR+RED)+(NIR+BLUE))', {
			SWIR: c.select('B11'),
			RED: c.select('B4'),
			NIR: c.select('B8'),
			BLUE: c.select('B2')
		})
		.rename('BSI');

	var evi = c
		.expression('2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))', {
			NIR: c.select('B8'),
			RED: c.select('B4'),
			BLUE: c.select('B2')
		})
		.rename('EVI');

	return c
		.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
		.addBands([ndvi, ndwi, ndbi, ndmi, bsi, evi]);
}

var baselineOptical = ee.ImageCollection.fromImages(
	ee.List.sequence(baselineStartYear, baselineEndYear).map(function (y) {
		return getOpticalComposite(y, currentMonth);
	})
)
	.median()
	.clip(aoi);

var currentOptical = getOpticalComposite(currentYear, currentMonth);

var baseline = baselineOptical.addBands(terrain).addBands(sarBaselineR);
var current = currentOptical.addBands(terrain).addBands(sarCurrentR);

print('Bands:', baseline.bandNames());

// Dynamic World classification helpers
function mapDwLabelToBhoomi(dwLabelImage) {
	// Dynamic World labels:
	// 0 water, 1 trees, 2 grass, 3 flooded_vegetation, 4 crops,
	// 5 shrub_and_scrub, 6 built, 7 bare, 8 snow_and_ice
	// Bhoomi labels:
	// 1 forest, 2 shrub, 3 crop, 4 urban, 5 barren, 6 water, 7 snow
	return dwLabelImage.remap([0, 1, 2, 3, 4, 5, 6, 7, 8], [6, 1, 2, 2, 3, 2, 4, 5, 7]).toInt();
}

function getDwCollectionWithFallback(startDate, endDate) {
	var primary = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
		.filterBounds(aoi)
		.filterDate(startDate, endDate);

	var fallback = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
		.filterBounds(aoi)
		.filterDate(ee.Date(endDate).advance(-12, 'month'), endDate);

	return ee.ImageCollection(ee.Algorithms.If(primary.size().gte(1), primary, fallback));
}

function getDynamicWorldClassComposite(startDate, endDate) {
	var dw = getDwCollectionWithFallback(startDate, endDate);
	var probBands = [
		'water',
		'trees',
		'grass',
		'flooded_vegetation',
		'crops',
		'shrub_and_scrub',
		'built',
		'bare',
		'snow_and_ice'
	];

	var clsNoMaskCollection = dw.map(function (img) {
		return mapDwLabelToBhoomi(img.select('label')).rename('cls');
	});

	var clsConfCollection = dw.map(function (img) {
		var maxProb = img.select(probBands).reduce(ee.Reducer.max()).rename('dw_conf');
		var cls = mapDwLabelToBhoomi(img.select('label'))
			.rename('cls')
			.updateMask(maxProb.gte(CONFIG.DW_MIN_CONFIDENCE));
		return cls.addBands(maxProb);
	});

	var clsModeNoMask = clsNoMaskCollection.reduce(ee.Reducer.mode()).rename('cls');
	var clsModeConf = clsConfCollection.select('cls').reduce(ee.Reducer.mode()).rename('cls');

	// Use confidence-masked mode where available; fallback to raw mode elsewhere.
	var cls = clsModeNoMask.where(clsModeConf.mask(), clsModeConf).rename('cls').clip(aoi);
	var confMean = clsConfCollection.select('dw_conf').mean().rename('dw_conf_mean').clip(aoi);

	return {
		cls: cls,
		conf: confMean,
		obsCount: dw.size()
	};
}

var dwBaselineStart = baselineStartDate;
var dwBaselineEnd = baselineEndDateExclusive;
var dwCurrentStart = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(-CONFIG.CURRENT_LOOKBACK_MONTHS, 'month');
var dwCurrentEnd = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(CONFIG.CURRENT_FORWARD_MONTHS, 'month');

var dwBaseline = getDynamicWorldClassComposite(dwBaselineStart, dwBaselineEnd);
var dwCurrent = getDynamicWorldClassComposite(dwCurrentStart, dwCurrentEnd);

var cls_baseline = dwBaseline.cls.focal_mode(1, 'square', 'pixels');
var cls_current = dwCurrent.cls.focal_mode(1, 'square', 'pixels');

print('DW observations baseline:', dwBaseline.obsCount);
print('DW observations current:', dwCurrent.obsCount);
print('Run year:', currentYear);
print('Run month:', currentMonth);
print('Baseline mode:', CONFIG.BASELINE_MODE);
print('Baseline start year:', baselineStartYear);
print('Baseline end year:', baselineEndYear);
print('DW mean confidence baseline:', dwBaseline.conf.reduceRegion({
	reducer: ee.Reducer.mean(),
	geometry: aoi,
	scale: 200,
	maxPixels: 1e12
}));
print('DW mean confidence current:', dwCurrent.conf.reduceRegion({
	reducer: ee.Reducer.mean(),
	geometry: aoi,
	scale: 200,
	maxPixels: 1e12
}));

// Change detection
var ndvi_delta = current.select('NDVI').subtract(baseline.select('NDVI'));
var ndwi_delta = current.select('NDWI').subtract(baseline.select('NDWI'));
var ndbi_delta = current.select('NDBI').subtract(baseline.select('NDBI'));
var bsi_delta = current.select('BSI').subtract(baseline.select('BSI'));
var evi_delta = current.select('EVI').subtract(baseline.select('EVI'));

function applyDensityCleanup(mask, kernel, minFraction) {
	var m = mask.selfMask();
	var density = m.unmask(0).reduceNeighborhood({
		reducer: ee.Reducer.mean(),
		kernel: kernel
	});
	return m.updateMask(density.gte(minFraction)).selfMask();
}

function cleanDefor(mask) {
	return applyDensityCleanup(mask, ee.Kernel.square(1), CONFIG.CLEAN_DEFOR_MIN_FRAC);
}
function cleanVeg(mask) {
	return applyDensityCleanup(mask, ee.Kernel.plus(1), CONFIG.CLEAN_VEG_MIN_FRAC);
}
function cleanWater(mask) {
	return mask.selfMask();
}
function cleanUrban(mask) {
	return applyDensityCleanup(mask, ee.Kernel.square(1), CONFIG.CLEAN_URBAN_MIN_FRAC);
}
function cleanSoil(mask) {
	return applyDensityCleanup(mask, ee.Kernel.plus(1), CONFIG.CLEAN_SOIL_MIN_FRAC);
}
function cleanAgri(mask) {
	return applyDensityCleanup(mask, ee.Kernel.plus(1), CONFIG.CLEAN_AGRI_MIN_FRAC);
}
function cleanPoaching(mask) {
	return applyDensityCleanup(mask, ee.Kernel.square(1), CONFIG.CLEAN_POACH_MIN_FRAC);
}

var nightLightsNow = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG')
	.filterDate(
		ee.Date.fromYMD(currentYear, currentMonth, 1).advance(-CONFIG.CURRENT_LOOKBACK_MONTHS, 'month'),
		ee.Date.fromYMD(currentYear, currentMonth, 1).advance(CONFIG.CURRENT_FORWARD_MONTHS, 'month')
	)
	.mean()
	.select('avg_rad')
	.clip(aoi);

var nightLightsBase = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG')
	.filterDate(baselineStartDate, baselineEndDateExclusive)
	.mean()
	.select('avg_rad')
	.clip(aoi);

var lightIncrease = nightLightsNow.subtract(nightLightsBase);

function buildThreatMap() {
	var wasForest = baseline.select('NDVI').gt(CONFIG.DEFOR_NDVI_FLOOR)
		.and(baseline.select('EVI').gt(CONFIG.DEFOR_EVI_FLOOR));
	var classFlipForest = cls_baseline.eq(1).and(cls_current.neq(1));

	var defor_high = wasForest.and(classFlipForest)
		.and(ndvi_delta.lt(CONFIG.DEFOR_DROP_HIGH));
	var defor_medium = wasForest.and(defor_high.not())
		.and(ndvi_delta.lt(CONFIG.DEFOR_DROP_MEDIUM))
		.and(evi_delta.lt(-0.10));
	var deforestation_raw = defor_high.or(defor_medium);

	var wasVeg = baseline.select('NDVI').gt(CONFIG.VEG_NDVI_FLOOR)
		.and(wasForest.not());
	var veg_high = wasVeg
		.and(cls_baseline.lte(3)).and(cls_current.gte(4))
		.and(ndvi_delta.lt(CONFIG.VEG_DROP_HIGH));
	var veg_medium = wasVeg.and(veg_high.not())
		.and(ndvi_delta.lt(CONFIG.VEG_DROP_MEDIUM));
	var vegLoss_raw = veg_high.or(veg_medium);

	var wasWater = baseline.select('NDWI').gt(CONFIG.WATER_NDWI_FLOOR)
		.and(baseline.select('NDVI').lt(0.20));
	var classFlipWater = cls_baseline.eq(6).and(cls_current.neq(6));
	var water_high = wasWater.and(classFlipWater)
		.and(ndwi_delta.lt(CONFIG.WATER_DROP_HIGH));
	var water_medium = wasWater.and(water_high.not())
		.and(ndwi_delta.lt(CONFIG.WATER_DROP_MEDIUM));
	var waterDeg_raw = water_high.or(water_medium);

	var classFlipUrban = cls_baseline.neq(4).and(cls_current.eq(4));
	var urban_high = classFlipUrban
		.and(ndbi_delta.gt(CONFIG.URBAN_NDBI_HIGH))
		.and(ndvi_delta.lt(-0.03));
	var urban_medium = urban_high.not()
		.and(ndbi_delta.gt(CONFIG.URBAN_NDBI_MEDIUM))
		.and(ndvi_delta.lt(-0.08));
	var urbanExp_raw = urban_high.or(urban_medium);

	var classFlipSoil = cls_baseline.neq(5).and(cls_current.eq(5));
	var soil_high = classFlipSoil.and(bsi_delta.gt(CONFIG.SOIL_BSI_HIGH));
	var soil_medium = soil_high.not()
		.and(bsi_delta.gt(CONFIG.SOIL_BSI_MEDIUM))
		.and(ndvi_delta.lt(-0.10))
		.and(cls_current.neq(4))
		.and(cls_current.neq(6));
	var soilDeg_raw = soil_high.or(soil_medium);

	var agriLoss_raw = cls_baseline.eq(3)
		.and(cls_current.eq(4).or(cls_current.eq(5)))
		.and(ndvi_delta.lt(CONFIG.AGRI_NDVI_DROP));

	var lightAnomalous = lightIncrease.gt(CONFIG.POACH_LIGHT_RISE);
	var isForest = cls_current.eq(1);
	var forestInterior = isForest.focal_min({radius: 2, kernelType: 'square', units: 'pixels'});
	var forestEdge = isForest.and(forestInterior.not());
	var forestLossZone = cls_baseline.eq(1).and(cls_current.neq(1));

	var poaching_raw = lightAnomalous
		.and(forestLossZone.or(forestEdge))
		.and(ndvi_delta.lt(CONFIG.POACH_NDVI_DROP))
		.and(cls_current.neq(4))
		.and(dem.gt(300));

	var deforestationF = cleanDefor(deforestation_raw);
	var vegLossF = cleanVeg(vegLoss_raw);
	var waterDegF = cleanWater(waterDeg_raw);
	var urbanExpF = cleanUrban(urbanExp_raw);
	var soilDegF = cleanSoil(soilDeg_raw);
	var agriLossF = cleanAgri(agriLoss_raw);
	var poachingF = cleanPoaching(poaching_raw);

	return {
		raw: ee.Image.cat([
			deforestation_raw.rename('deforestation'),
			vegLoss_raw.rename('vegLoss'),
			waterDeg_raw.rename('waterDeg'),
			urbanExp_raw.rename('urbanExp'),
			soilDeg_raw.rename('soilDeg'),
			agriLoss_raw.rename('agriLoss'),
			poaching_raw.rename('poaching')
		]).clip(aoi),
		clean: {
			deforestation: deforestationF,
			vegLoss: vegLossF,
			waterDeg: waterDegF,
			urbanExp: urbanExpF,
			soilDeg: soilDegF,
			agriLoss: agriLossF,
			poaching: poachingF
		}
	};
}

function getAreaKm2(mask, scale) {
	return ee.Number(
		ee.Image.pixelArea().updateMask(mask).reduceRegion({
			reducer: ee.Reducer.sum(),
			geometry: aoi,
			scale: scale,
			maxPixels: 1e12,
			tileScale: 4
		}).get('area')
	).divide(1e6);
}

var runButton = ui.Button({
	label: 'RUN THREAT ANALYSIS',
	style: {color: 'white', fontWeight: 'bold', padding: '10px'}
});
var statusLabel = ui.Label('Click button after layers load');
var panel = ui.Panel([
	ui.Label('BhoomiRakshak v7.7-dw', {fontWeight: 'bold', fontSize: '16px'}),
	ui.Label('Dynamic World classifier | 7 threats | hybrid alerts', {fontSize: '11px', color: 'gray'}),
	statusLabel,
	runButton
], ui.Panel.Layout.Flow('vertical'), {position: 'top-right', padding: '8px'});
Map.add(panel);

runButton.onClick(function () {
	statusLabel.setValue('Computing 7 threats...');
	runButton.setDisabled(true);

	var result = buildThreatMap();
	var raw = result.raw;
	var clean = result.clean;

	var S = CONFIG.STATS_SCALE_DEFAULT;
	var SW = CONFIG.STATS_SCALE_WATER;
	var SV = CONFIG.STATS_SCALE_VEG;

	var rawStats = ee.Dictionary({
		defor: getAreaKm2(raw.select('deforestation'), S),
		veg: getAreaKm2(raw.select('vegLoss'), SV),
		water: getAreaKm2(raw.select('waterDeg'), SW),
		urban: getAreaKm2(raw.select('urbanExp'), S),
		soil: getAreaKm2(raw.select('soilDeg'), S),
		agri: getAreaKm2(raw.select('agriLoss'), S),
		poach: getAreaKm2(raw.select('poaching'), S)
	});

	rawStats.evaluate(function (s) {
		if (!s) {
			statusLabel.setValue('Raw stats failed');
			runButton.setDisabled(false);
			return;
		}

		print('RAW THREAT DETECTIONS (km2)');
		print('  Deforestation:   ' + (s.defor || 0).toFixed(1));
		print('  Vegetation Loss: ' + (s.veg || 0).toFixed(1));
		print('  Water Degrad:    ' + (s.water || 0).toFixed(1));
		print('  Urban Expansion: ' + (s.urban || 0).toFixed(1));
		print('  Soil Degrad:     ' + (s.soil || 0).toFixed(1));
		print('  Agri Loss:       ' + (s.agri || 0).toFixed(1));
		print('  Poaching Proxy:  ' + (s.poach || 0).toFixed(1));

		var filtStats = ee.Dictionary({
			defor: getAreaKm2(clean.deforestation, S),
			veg: getAreaKm2(clean.vegLoss, SV),
			water: getAreaKm2(clean.waterDeg, SW),
			urban: getAreaKm2(clean.urbanExp, S),
			soil: getAreaKm2(clean.soilDeg, S),
			agri: getAreaKm2(clean.agriLoss, S),
			poach: getAreaKm2(clean.poaching, S),
			aoi_default_km2: getAreaKm2(ee.Image.constant(1).clip(aoi), S),
			aoi_water_km2: getAreaKm2(ee.Image.constant(1).clip(aoi), SW),
			aoi_veg_km2: getAreaKm2(ee.Image.constant(1).clip(aoi), SV)
		});

		filtStats.evaluate(function (f) {
			if (!f) {
				statusLabel.setValue('Filtered stats failed');
				runButton.setDisabled(false);
				return;
			}

			var aoiDefaultKm2 = f.aoi_default_km2 || 0;
			var aoiWaterKm2 = f.aoi_water_km2 || aoiDefaultKm2;
			var aoiVegKm2 = f.aoi_veg_km2 || aoiDefaultKm2;

			function pctOfAoi(val, aoiKm2) {
				if (!aoiKm2 || aoiKm2 === 0) return 0;
				return ((val || 0) / aoiKm2) * 100;
			}

			print('FILTERED THREAT AREAS (km2)');
			print('  Deforestation:   ' + (f.defor || 0).toFixed(2));
			print('  Vegetation Loss: ' + (f.veg || 0).toFixed(2));
			print('  Water Degrad:    ' + (f.water || 0).toFixed(2));
			print('  Urban Expansion: ' + (f.urban || 0).toFixed(2));
			print('  Soil Degrad:     ' + (f.soil || 0).toFixed(2));
			print('  Agri Loss:       ' + (f.agri || 0).toFixed(2));
			print('  Poaching Proxy:  ' + (f.poach || 0).toFixed(2));

			print('AOI-NORMALIZED THREATS (% AOI)');
			print('  Deforestation:   ' + pctOfAoi(f.defor, aoiDefaultKm2).toFixed(3) + '%');
			print('  Vegetation Loss: ' + pctOfAoi(f.veg, aoiVegKm2).toFixed(3) + '%');
			print('  Water Degrad:    ' + pctOfAoi(f.water, aoiWaterKm2).toFixed(3) + '%');
			print('  Urban Expansion: ' + pctOfAoi(f.urban, aoiDefaultKm2).toFixed(3) + '%');
			print('  Soil Degrad:     ' + pctOfAoi(f.soil, aoiDefaultKm2).toFixed(3) + '%');
			print('  Agri Loss:       ' + pctOfAoi(f.agri, aoiDefaultKm2).toFixed(3) + '%');
			print('  Poaching Proxy:  ' + pctOfAoi(f.poach, aoiDefaultKm2).toFixed(3) + '%');

			var alerts = [];
			function chk(name, val, absThresh, pctThresh, aoiKm2) {
				var v = (val || 0);
				var p = pctOfAoi(v, aoiKm2);
				var pctGate = (pctThresh || 0);
				if (v > absThresh && p > pctGate) {
					var severity = v > absThresh * 3 ? 'HIGH' : (v > absThresh * 2 ? 'MODERATE' : 'LOW');
					alerts.push(name + ': ' + v.toFixed(2) + ' km2 | ' + p.toFixed(3) + '% AOI | ' + severity);
				}
			}

			chk('DEFORESTATION', f.defor, CONFIG.ALERT_DEFOR, CONFIG.ALERT_DEFOR_PCT, aoiDefaultKm2);
			chk('VEG LOSS', f.veg, CONFIG.ALERT_VEG, CONFIG.ALERT_VEG_PCT, aoiVegKm2);
			chk('WATER', f.water, CONFIG.ALERT_WATER, CONFIG.ALERT_WATER_PCT, aoiWaterKm2);
			chk('URBAN', f.urban, CONFIG.ALERT_URBAN, CONFIG.ALERT_URBAN_PCT, aoiDefaultKm2);
			chk('SOIL', f.soil, CONFIG.ALERT_SOIL, CONFIG.ALERT_SOIL_PCT, aoiDefaultKm2);
			chk('AGRI', f.agri, CONFIG.ALERT_AGRI, CONFIG.ALERT_AGRI_PCT, aoiDefaultKm2);
			chk('POACHING', f.poach, CONFIG.ALERT_POACH, CONFIG.ALERT_POACH_PCT, aoiDefaultKm2);

			if (alerts.length > 0) {
				print('ACTIVE ALERTS (' + alerts.length + '/7)');
				alerts.forEach(function (a) { print('  ' + a); });
				statusLabel.setValue('Completed with ' + alerts.length + ' alerts');
			} else {
				print('NO ALERTS');
				statusLabel.setValue('Completed without alerts');
			}

			var threatVis = ee.Image(0)
				.where(clean.agriLoss, 6)
				.where(clean.vegLoss, 2)
				.where(clean.soilDeg, 5)
				.where(clean.urbanExp, 4)
				.where(clean.waterDeg, 3)
				.where(clean.poaching, 7)
				.where(clean.deforestation, 1)
				.clip(aoi)
				.selfMask();

			var threatPal = ['#d73027', '#78c679', '#2171b5', '#9e0142', '#f4a460', '#ffd700', '#ff00ff'];
			Map.addLayer(threatVis, {min: 1, max: 7, palette: threatPal}, 'Threats v7.7-dw', true);
			Map.addLayer(clean.deforestation.selfMask(), {palette: ['#d73027']}, 'Deforestation', false);
			Map.addLayer(clean.vegLoss.selfMask(), {palette: ['#78c679']}, 'Veg Loss', false);
			Map.addLayer(clean.waterDeg.selfMask(), {palette: ['#2171b5']}, 'Water', false);
			Map.addLayer(clean.urbanExp.selfMask(), {palette: ['#9e0142']}, 'Urban', false);
			Map.addLayer(clean.soilDeg.selfMask(), {palette: ['#f4a460']}, 'Soil', false);
			Map.addLayer(clean.agriLoss.selfMask(), {palette: ['#ffd700']}, 'Agri', false);
			Map.addLayer(clean.poaching.selfMask(), {palette: ['#ff00ff']}, 'Poaching', false);

			runButton.setDisabled(false);
		});
	});
});

var lulcStats = ee.Dictionary({
	forest_km2: getAreaKm2(cls_current.eq(1), CONFIG.STATS_SCALE_DEFAULT),
	shrub_km2: getAreaKm2(cls_current.eq(2), CONFIG.STATS_SCALE_DEFAULT),
	crop_km2: getAreaKm2(cls_current.eq(3), CONFIG.STATS_SCALE_DEFAULT),
	urban_km2: getAreaKm2(cls_current.eq(4), CONFIG.STATS_SCALE_DEFAULT),
	barren_km2: getAreaKm2(cls_current.eq(5), CONFIG.STATS_SCALE_DEFAULT),
	water_km2: getAreaKm2(cls_current.eq(6), CONFIG.STATS_SCALE_WATER),
	snow_km2: getAreaKm2(cls_current.eq(7), CONFIG.STATS_SCALE_DEFAULT)
});

lulcStats.evaluate(function (s) {
	if (!s) {
		print('LULC stats failed');
		return;
	}
	print('LULC AREAS (km2)');
	print('  Forest: ' + (s.forest_km2 || 0).toFixed(1));
	print('  Shrub:  ' + (s.shrub_km2 || 0).toFixed(1));
	print('  Crop:   ' + (s.crop_km2 || 0).toFixed(1));
	print('  Urban:  ' + (s.urban_km2 || 0).toFixed(1));
	print('  Barren: ' + (s.barren_km2 || 0).toFixed(1));
	print('  Water:  ' + (s.water_km2 || 0).toFixed(1));
	print('  Snow:   ' + (s.snow_km2 || 0).toFixed(1));
});

var lulcPal = ['#1a9850', '#74c476', '#fed976', '#e31a1c', '#d4b483', '#4575b4', '#ffffff'];
Map.addLayer(cls_current, {min: 1, max: 7, palette: lulcPal}, 'LULC Current (DW)', true);
Map.addLayer(cls_baseline, {min: 1, max: 7, palette: lulcPal}, 'LULC Baseline (DW)', false);
Map.addLayer(ndvi_delta, {
	min: -0.4,
	max: 0.4,
	palette: ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#1a9850']
}, 'NDVI delta', false);
Map.addLayer(ndbi_delta, {
	min: -0.3,
	max: 0.3,
	palette: ['#1a9850', '#fee08b', '#d73027']
}, 'NDBI delta', false);
Map.addLayer(bsi_delta, {
	min: -0.3,
	max: 0.3,
	palette: ['#1a9850', '#fee08b', '#d73027']
}, 'BSI delta', false);
Map.addLayer(lightIncrease, {
	min: -2,
	max: 5,
	palette: ['#000033', '#000066', '#ffff00', '#ff0000']
}, 'Night Light delta', false);

print('v7.7-dw loaded - Dynamic World classifier - click RUN THREAT ANALYSIS');
```

```
Bands:
List (18 elements)
0: B2
1: B3
2: B4
3: B8
4: B11
5: B12
6: NDVI
7: NDWI
8: NDBI
9: NDMI
10: BSI
11: EVI
12: elevation
13: slope
14: aspect
15: VV
16: VH
17: VV_VH_ratio
DW observations baseline:
1145
DW observations current:
86
Run year:
2026
Run month:
4
Baseline mode:
rolling
Baseline start year:
2020
Baseline end year:
2024
DW mean confidence baseline:
Object (1 property)
dw_conf_mean: 0.5348963133735876
DW mean confidence current:
Object (1 property)
dw_conf_mean: 0.5091955150858188
v7.7-dw loaded - Dynamic World classifier - click RUN THREAT ANALYSIS
LULC AREAS (km2)
  Forest: 2043.5
  Shrub:  423.3
  Crop:   94.3
  Urban:  441.5
  Barren: 40.9
  Water:  24.8
  Snow:   6.4
RAW THREAT DETECTIONS (km2)
  Deforestation:   24.6
  Vegetation Loss: 11.7
  Water Degrad:    0.6
  Urban Expansion: 18.4
  Soil Degrad:     8.2
  Agri Loss:       2.5
  Poaching Proxy:  1.6
FILTERED THREAT AREAS (km2)
  Deforestation:   6.75
  Vegetation Loss: 5.56
  Water Degrad:    0.62
  Urban Expansion: 6.09
  Soil Degrad:     2.52
  Agri Loss:       1.45
  Poaching Proxy:  0.20
AOI-NORMALIZED THREATS (% AOI)
  Deforestation:   0.220%
  Vegetation Loss: 0.181%
  Water Degrad:    0.020%
  Urban Expansion: 0.199%
  Soil Degrad:     0.082%
  Agri Loss:       0.047%
  Poaching Proxy:  0.007%
NO ALERTS
```