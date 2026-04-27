```js
// ================================================================
// BhoomiRakshak v7.7-hybrid — Dynamic World + Random Forest Fusion
// ================================================================
// HOW FUSION WORKS:
//   1. Dynamic World classifies every pixel with a confidence score
//   2. Where DW confidence >= 0.6  → use DW classification
//   3. Where DW confidence <  0.6  → use RF classification instead
//   4. RF is trained on ESA WorldCover 2021 labels (same 7-class schema)
//   5. Both classifiers use identical input bands (optical + terrain + SAR)
// ================================================================

var districts = ee.FeatureCollection("FAO/GAUL/2015/level2");
var aoi = districts
  .filter(ee.Filter.eq('ADM1_NAME', 'Uttarakhand'))
  .filter(ee.Filter.eq('ADM2_NAME', 'Dehra Dun'))
  .geometry();

Map.centerObject(aoi, 11);

var now          = ee.Date(Date.now());
var currentYear  = now.get('year');
var currentMonth = now.get('month');

var CONFIG = {
  // RF training parameters
  SAMPLES_PER_CLASS:   400,
  SAMPLE_SCALE:        50,
  RF_TREES:            50,
  TRAIN_SPLIT:         0.7,

  // Cloud filtering
  CLOUD_STRICT:        15,
  CLOUD_RELAXED:       35,

  // DW confidence threshold — pixels below this fall back to RF
  DW_MIN_CONFIDENCE:   0.6,

  // Stats scale
  STATS_SCALE_DEFAULT: 100,
  STATS_SCALE_WATER:   50,
  STATS_SCALE_VEG:     50,

  // Deforestation
  DEFOR_NDVI_FLOOR:     0.45,
  DEFOR_EVI_FLOOR:      0.25,
  DEFOR_DROP_HIGH:     -0.10,
  DEFOR_DROP_MEDIUM:   -0.20,

  // Vegetation loss
  VEG_NDVI_FLOOR:       0.35,
  VEG_DROP_HIGH:       -0.10,
  VEG_DROP_MEDIUM:     -0.18,

  // Water
  WATER_NDWI_FLOOR:     0.18,
  WATER_DROP_HIGH:     -0.08,
  WATER_DROP_MEDIUM:   -0.14,

  // Urban
  URBAN_NDBI_HIGH:      0.08,
  URBAN_NDBI_MEDIUM:    0.14,

  // Soil
  SOIL_BSI_HIGH:        0.06,
  SOIL_BSI_MEDIUM:      0.15,

  // Agriculture
  AGRI_NDVI_DROP:      -0.10,

  // Poaching proxy
  POACH_LIGHT_RISE:     5.0,
  POACH_NDVI_DROP:     -0.15,

  // Cleanup density gates
  CLEAN_DEFOR_MIN_FRAC:   0.40,
  CLEAN_VEG_MIN_FRAC:     0.40,
  CLEAN_URBAN_MIN_FRAC:   0.35,
  CLEAN_SOIL_MIN_FRAC:    0.42,
  CLEAN_AGRI_MIN_FRAC:    0.40,
  CLEAN_POACH_MIN_FRAC:   0.55,

  // Alerts (km2)
  ALERT_DEFOR:  5.0,
  ALERT_URBAN:  10.0,
  ALERT_WATER:  1.0,
  ALERT_AGRI:   8.0,
  ALERT_POACH:  1.0,
  ALERT_SOIL:   5.0,
  ALERT_VEG:    8.0,

  // Alerts (% of AOI)
  ALERT_DEFOR_PCT: 0.5,
  ALERT_VEG_PCT:   0.4,
  ALERT_WATER_PCT: 0.045,
  ALERT_URBAN_PCT: 0.8,
  ALERT_SOIL_PCT:  0.3,
  ALERT_AGRI_PCT:  0.4,
  ALERT_POACH_PCT: 0.05
};


// ── TERRAIN ──────────────────────────────────────────────────
var dem    = ee.Image('USGS/SRTMGL1_003').clip(aoi).rename('elevation');
var slope  = ee.Terrain.slope(dem).clip(aoi).rename('slope');
var aspect = ee.Terrain.aspect(dem).clip(aoi).rename('aspect');
var terrain = dem.addBands([slope, aspect]);


// ── SAR ──────────────────────────────────────────────────────
var sarBaseline = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi).filterDate('2018-01-01', '2020-12-31')
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .select(['VV', 'VH']).median().clip(aoi);

var sarCurrentStart = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(-3, 'month');
var sarCurrentEnd   = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(1, 'month');
var sarCurrent = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi).filterDate(sarCurrentStart, sarCurrentEnd)
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .select(['VV', 'VH']).median().clip(aoi);

var sarBaselineR = sarBaseline.addBands(
  sarBaseline.select('VV').subtract(sarBaseline.select('VH')).rename('VV_VH_ratio'));
var sarCurrentR = sarCurrent.addBands(
  sarCurrent.select('VV').subtract(sarCurrent.select('VH')).rename('VV_VH_ratio'));


// ── CLOUD MASKING ────────────────────────────────────────────
function maskS2Clouds(img) {
  var scl = img.select('SCL');
  return img.updateMask(
    scl.neq(1).and(scl.neq(3)).and(scl.neq(7))
       .and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10))
  ).divide(10000).copyProperties(img, ['system:time_start']);
}

// Build optical composite with 3-level cloud fallback
function getOpticalComposite(year, month) {
  year  = ee.Number(year);
  month = ee.Number(month);
  var startDate = ee.Date.fromYMD(year, month, 1).advance(-1, 'month');
  var endDate   = ee.Date.fromYMD(year, month, 1).advance(2, 'month');

  var strict = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.CLOUD_STRICT))
    .map(maskS2Clouds);
  var relaxed = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi).filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.CLOUD_RELAXED))
    .map(maskS2Clouds);
  var fallback = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(ee.Date.fromYMD(year, 1, 1), ee.Date.fromYMD(year, 12, 31))
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.CLOUD_RELAXED))
    .map(maskS2Clouds);

  var chosen = ee.Algorithms.If(
    strict.size().gte(3), strict,
    ee.Algorithms.If(relaxed.size().gte(1), relaxed, fallback));
  var c = ee.ImageCollection(chosen).median().clip(aoi);

  var ndvi = c.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = c.normalizedDifference(['B3', 'B11']).rename('NDWI');
  var ndbi = c.normalizedDifference(['B11', 'B8']).rename('NDBI');
  var ndmi = c.normalizedDifference(['B8', 'B11']).rename('NDMI');
  var bsi  = c.expression(
    '((SWIR+RED)-(NIR+BLUE))/((SWIR+RED)+(NIR+BLUE))',
    {SWIR: c.select('B11'), RED: c.select('B4'),
     NIR: c.select('B8'), BLUE: c.select('B2')}
  ).rename('BSI');
  var evi = c.expression(
    '2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))',
    {NIR: c.select('B8'), RED: c.select('B4'), BLUE: c.select('B2')}
  ).rename('EVI');

  return c.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
    .addBands([ndvi, ndwi, ndbi, ndmi, bsi, evi]);
}

// Baseline optical: 2018-2020 median at current month
var baselineOptical = ee.ImageCollection.fromImages(
  ee.List.sequence(2018, 2020).map(function(y) {
    return getOpticalComposite(y, currentMonth);
  })
).median().clip(aoi);

var currentOptical = getOpticalComposite(currentYear, currentMonth);

var baseline = baselineOptical.addBands(terrain).addBands(sarBaselineR);
var current  = currentOptical.addBands(terrain).addBands(sarCurrentR);


// ================================================================
// RANDOM FOREST CLASSIFIER
// ================================================================
// Trained on ESA WorldCover 2021 labels remapped to 7-class schema.
// Used to fill pixels where DW confidence < DW_MIN_CONFIDENCE.
// Same 18-band input as baseline image (optical + terrain + SAR).
// ================================================================

// Remap ESA WorldCover 11-class schema to Bhoomi 7-class schema
var worldcover = ee.Image('ESA/WorldCover/v200/2021').select('Map').clip(aoi);
var labels = worldcover.remap(
  [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
  [ 1,  2,  2,  3,  4,  5,  7,  6,  6,  2,  2]
).rename('label').toInt();

var inputBands = baseline.bandNames();

// Stratified sample — 400 points per class at 50m scale
var allSamples = baseline
  .addBands(labels).updateMask(labels.neq(0))
  .stratifiedSample({
    numPoints:  CONFIG.SAMPLES_PER_CLASS,
    classBand:  'label',
    region:     aoi,
    scale:      CONFIG.SAMPLE_SCALE,
    seed:       42,
    tileScale:  4,
    geometries: false
  }).randomColumn('split', 42);

var trainSet = allSamples.filter(ee.Filter.lt('split', CONFIG.TRAIN_SPLIT));
var valSet   = allSamples.filter(ee.Filter.gte('split', CONFIG.TRAIN_SPLIT));

// Train Smile Random Forest
var rfClassifier = ee.Classifier.smileRandomForest({
  numberOfTrees: CONFIG.RF_TREES,
  seed: 42
}).train({
  features:        trainSet,
  classProperty:   'label',
  inputProperties: inputBands
});

// Print RF accuracy on held-out validation set
var confMatrix = valSet.classify(rfClassifier).errorMatrix('label', 'classification');
ee.Dictionary({accuracy: confMatrix.accuracy(), kappa: confMatrix.kappa()})
  .evaluate(function(r) {
    if (r) {
      print('---------------------------------------------');
      print('RF ACCURACY: ' + (r.accuracy * 100).toFixed(1) + '%  |  Kappa: ' + r.kappa.toFixed(3));
    }
  });

// RF classification of baseline and current image stacks
var rfClassBaseline = baseline.classify(rfClassifier)
  .focal_mode(1, 'square', 'pixels').rename('cls');
var rfClassCurrent  = current.classify(rfClassifier)
  .focal_mode(1, 'square', 'pixels').rename('cls');


// ================================================================
// DYNAMIC WORLD CLASSIFIER
// ================================================================
// Processes DW probability bands with spatial smoothing before
// taking argmax. Confidence = max probability across all 9 classes.
// ================================================================

function mapDwLabelToBhoomi(dwLabelImage) {
  // DW labels: 0=water, 1=trees, 2=grass, 3=flooded_veg, 4=crops,
  //            5=shrub, 6=built, 7=bare, 8=snow_and_ice
  // Bhoomi:    1=forest, 2=shrub, 3=crop, 4=urban, 5=barren, 6=water, 7=snow
  return dwLabelImage.remap(
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [6, 1, 2, 2, 3, 2, 4, 5, 7]
  ).toInt();
}

function getDwCollection(startDate, endDate) {
  // Restrict to same season months to avoid mixing monsoon + dry observations
  var startMonth = currentMonth.subtract(1);
  var endMonth   = currentMonth.add(1);

  var primary = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoi)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.calendarRange(startMonth, endMonth, 'month'));

  var seasonFallback = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoi)
    .filterDate(ee.Date(endDate).advance(-12, 'month'), endDate)
    .filter(ee.Filter.calendarRange(startMonth, endMonth, 'month'));

  // Final fallback: no season filter if seasonal filter returns nothing
  var noFilterFallback = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoi)
    .filterDate(startDate, endDate);

  return ee.ImageCollection(
    ee.Algorithms.If(
      primary.size().gte(1), primary,
      ee.Algorithms.If(seasonFallback.size().gte(1), seasonFallback, noFilterFallback)
    )
  );
}


// Returns {cls, conf} where conf = mean max-probability across observations
function getDwComposite(startDate, endDate) {
  var dw = getDwCollection(startDate, endDate);
  var probBands = ['water','trees','grass','flooded_vegetation',
                   'crops','shrub_and_scrub','built','bare','snow_and_ice'];

  // Smooth probability bands spatially before argmax to reduce salt-and-pepper
  var smoothed = dw.map(function(img) {
    return img.select(probBands).focal_mean(1, 'square', 'pixels');
  }).mean();

  var maxProb = smoothed.reduce(ee.Reducer.max()).rename('dw_conf');
  var cls = mapDwLabelToBhoomi(
    smoothed.toArray().arrayArgmax().arrayGet([0])
  ).rename('cls');

  return {cls: cls, conf: maxProb};
}


// ================================================================
// HYBRID FUSION
// ================================================================
// Rule: use DW classification where DW confidence >= 0.6
//       use RF classification where DW confidence <  0.6
// This preserves DW accuracy in clear/high-confidence zones and
// improves classification in ambiguous terrain (forest-shrub
// transitions, periurban boundaries) using local RF knowledge.
// ================================================================

function getHybridClassification(startDate, endDate, rfClass) {
  var dwColl = getDwCollection(startDate, endDate);
  var hasObs = dwColl.size().gte(1);

  // If DW has observations: smooth probs, take argmax, compute confidence
  var probBands = ['water','trees','grass','flooded_vegetation',
                   'crops','shrub_and_scrub','built','bare','snow_and_ice'];

  var smoothed = ee.ImageCollection(
    ee.Algorithms.If(
      hasObs,
      dwColl.map(function(img) {
        return img.select(probBands).focal_mean(1, 'square', 'pixels');
      }),
      ee.ImageCollection([ee.Image.constant(0).rename(probBands)])
    )
  ).mean();

  var maxProb  = smoothed.reduce(ee.Reducer.max()).rename('dw_conf');
  var dwCls    = mapDwLabelToBhoomi(
    smoothed.toArray().arrayArgmax().arrayGet([0])
  ).rename('cls');

  // Where DW has no observations at all: use pure RF
  var dwClsFinal  = ee.Image(ee.Algorithms.If(hasObs, dwCls,  rfClass));
  var dwConfFinal = ee.Image(ee.Algorithms.If(hasObs, maxProb,
    ee.Image.constant(0).rename('dw_conf'))).clip(aoi);

  // Where DW conf >= threshold: use DW; below threshold: use RF
  var highConfMask = dwConfFinal.gte(CONFIG.DW_MIN_CONFIDENCE);
  var fused = rfClass
    .where(highConfMask, dwClsFinal)
    .clip(aoi)
    .rename('cls');

  return {cls: fused, conf: dwConfFinal};
}

var dwBaselineLagYears   = 2;
var dwBaselineYears      = 5;
var dwBaselineEndYear    = currentYear.subtract(dwBaselineLagYears);
var dwBaselineStartYear  = dwBaselineEndYear.subtract(dwBaselineYears - 1);
var dwBaselineStart      = ee.Date.fromYMD(dwBaselineStartYear, 1, 1);
var dwBaselineEnd        = ee.Date.fromYMD(dwBaselineEndYear.add(1), 1, 1);

// Current classification window: 3 months lookback
var dwCurrentStart = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(-3, 'month');
var dwCurrentEnd   = ee.Date.fromYMD(currentYear, currentMonth, 1).advance(1, 'month');

var hybridBaseline = getHybridClassification(dwBaselineStart, dwBaselineEnd, rfClassBaseline);
var hybridCurrent  = getHybridClassification(dwCurrentStart,  dwCurrentEnd,  rfClassCurrent);

// Apply mode smoothing to fused maps to remove residual noise
var cls_baseline = hybridBaseline.cls.focal_mode(1, 'square', 'pixels');
var cls_current  = hybridCurrent.cls.focal_mode(1, 'square', 'pixels');

// Print DW confidence diagnostics
print('---------------------------------------------');
print('DW confidence diagnostics (mean across AOI)');
hybridBaseline.conf.reduceRegion({
  reducer: ee.Reducer.mean(), geometry: aoi, scale: 200, maxPixels: 1e12
}).evaluate(function(r) { print('  DW conf baseline: ' + (r.dw_conf || 0).toFixed(4)); });
hybridCurrent.conf.reduceRegion({
  reducer: ee.Reducer.mean(), geometry: aoi, scale: 200, maxPixels: 1e12
}).evaluate(function(r) { print('  DW conf current:  ' + (r.dw_conf || 0).toFixed(4)); });


// ── SPECTRAL INDEX DELTAS ─────────────────────────────────────
var ndvi_delta = current.select('NDVI').subtract(baseline.select('NDVI'));
var ndwi_delta = current.select('NDWI').subtract(baseline.select('NDWI'));
var ndbi_delta = current.select('NDBI').subtract(baseline.select('NDBI'));
var bsi_delta  = current.select('BSI').subtract(baseline.select('BSI'));
var evi_delta  = current.select('EVI').subtract(baseline.select('EVI'));


// ── CLEANUP FUNCTIONS ─────────────────────────────────────────
function applyDensityCleanup(mask, kernel, minFraction) {
  var m = mask.selfMask();
  var density = m.unmask(0).reduceNeighborhood({
    reducer: ee.Reducer.mean(), kernel: kernel
  });
  return m.updateMask(density.gte(minFraction)).selfMask();
}
function cleanDefor(mask)    { return applyDensityCleanup(mask, ee.Kernel.square(1), CONFIG.CLEAN_DEFOR_MIN_FRAC); }
function cleanVeg(mask)      { return applyDensityCleanup(mask, ee.Kernel.plus(1),   CONFIG.CLEAN_VEG_MIN_FRAC);   }
function cleanWater(mask)    { return mask.selfMask(); }
function cleanUrban(mask)    { return applyDensityCleanup(mask, ee.Kernel.square(1), CONFIG.CLEAN_URBAN_MIN_FRAC); }
function cleanSoil(mask)     { return applyDensityCleanup(mask, ee.Kernel.plus(1),   CONFIG.CLEAN_SOIL_MIN_FRAC);  }
function cleanAgri(mask)     { return applyDensityCleanup(mask, ee.Kernel.plus(1),   CONFIG.CLEAN_AGRI_MIN_FRAC);  }
function cleanPoaching(mask) { return applyDensityCleanup(mask, ee.Kernel.square(1), CONFIG.CLEAN_POACH_MIN_FRAC); }


// ── NIGHT LIGHTS ──────────────────────────────────────────────
var nightLightsNow = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG')
  .filterDate(
    ee.Date.fromYMD(currentYear, currentMonth, 1).advance(-3, 'month'),
    ee.Date.fromYMD(currentYear, currentMonth, 1)
  ).mean().select('avg_rad').clip(aoi);

var nightLightsBase = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG')
  .filterDate('2018-01-01', '2020-12-31')
  .mean().select('avg_rad').clip(aoi);

var lightIncrease = nightLightsNow.subtract(nightLightsBase);


// ── THREAT DETECTION ─────────────────────────────────────────
function buildThreatMap() {

  // 1. DEFORESTATION
  var wasForest = baseline.select('NDVI').gt(CONFIG.DEFOR_NDVI_FLOOR)
    .and(baseline.select('EVI').gt(CONFIG.DEFOR_EVI_FLOOR));
  var classFlipForest = cls_baseline.eq(1).and(cls_current.neq(1));
  var defor_high   = wasForest.and(classFlipForest).and(ndvi_delta.lt(CONFIG.DEFOR_DROP_HIGH));
  var defor_medium = wasForest.and(defor_high.not())
    .and(ndvi_delta.lt(CONFIG.DEFOR_DROP_MEDIUM)).and(evi_delta.lt(-0.10));
  var deforestation_raw = defor_high.or(defor_medium);

  // 2. VEGETATION LOSS
  var wasVeg = baseline.select('NDVI').gt(CONFIG.VEG_NDVI_FLOOR).and(wasForest.not());
  var veg_high   = wasVeg.and(cls_baseline.lte(3)).and(cls_current.gte(4))
    .and(ndvi_delta.lt(CONFIG.VEG_DROP_HIGH));
  var veg_medium = wasVeg.and(veg_high.not()).and(ndvi_delta.lt(CONFIG.VEG_DROP_MEDIUM));
  var vegLoss_raw = veg_high.or(veg_medium);

  // 3. WATER DEGRADATION
  var wasWater = baseline.select('NDWI').gt(CONFIG.WATER_NDWI_FLOOR)
    .and(baseline.select('NDVI').lt(0.20));
  var classFlipWater = cls_baseline.eq(6).and(cls_current.neq(6));
  var water_high   = wasWater.and(classFlipWater).and(ndwi_delta.lt(CONFIG.WATER_DROP_HIGH));
  var water_medium = wasWater.and(water_high.not()).and(ndwi_delta.lt(CONFIG.WATER_DROP_MEDIUM));
  var waterDeg_raw = water_high.or(water_medium);

  // 4. URBAN EXPANSION
  var classFlipUrban = cls_baseline.neq(4).and(cls_current.eq(4));
  var urban_high   = classFlipUrban.and(ndbi_delta.gt(CONFIG.URBAN_NDBI_HIGH))
    .and(ndvi_delta.lt(-0.03));
  var urban_medium = urban_high.not().and(ndbi_delta.gt(CONFIG.URBAN_NDBI_MEDIUM))
    .and(ndvi_delta.lt(-0.08));
  var urbanExp_raw = urban_high.or(urban_medium);

  // 5. SOIL DEGRADATION
  var classFlipSoil = cls_baseline.neq(5).and(cls_current.eq(5));
  var soil_high   = classFlipSoil.and(bsi_delta.gt(CONFIG.SOIL_BSI_HIGH));
  var soil_medium = soil_high.not().and(bsi_delta.gt(CONFIG.SOIL_BSI_MEDIUM))
    .and(ndvi_delta.lt(-0.10)).and(cls_current.neq(4)).and(cls_current.neq(6));
  var soilDeg_raw = soil_high.or(soil_medium);

  // 6. AGRICULTURAL LOSS
  var agriLoss_raw = cls_baseline.eq(3)
    .and(cls_current.eq(4).or(cls_current.eq(5)))
    .and(ndvi_delta.lt(CONFIG.AGRI_NDVI_DROP));

  // 7. POACHING PROXY
  var lightAnomalous  = lightIncrease.gt(CONFIG.POACH_LIGHT_RISE);
  var isForest        = cls_current.eq(1);
  var forestInterior  = isForest.focal_min({radius: 2, kernelType: 'square', units: 'pixels'});
  var forestEdge      = isForest.and(forestInterior.not());
  var forestLossZone  = cls_baseline.eq(1).and(cls_current.neq(1));
  var poaching_raw = lightAnomalous
    .and(forestLossZone.or(forestEdge))
    .and(ndvi_delta.lt(CONFIG.POACH_NDVI_DROP))
    .and(cls_current.neq(4))
    .and(dem.gt(300));

  // Apply per-threat spatial cleanup
  var deforestationF = cleanDefor(deforestation_raw);
  var vegLossF       = cleanVeg(vegLoss_raw);
  var waterDegF      = cleanWater(waterDeg_raw);
  var urbanExpF      = cleanUrban(urbanExp_raw);
  var soilDegF       = cleanSoil(soilDeg_raw);
  var agriLossF      = cleanAgri(agriLoss_raw);
  var poachingF      = cleanPoaching(poaching_raw);

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
      vegLoss:       vegLossF,
      waterDeg:      waterDegF,
      urbanExp:      urbanExpF,
      soilDeg:       soilDegF,
      agriLoss:      agriLossF,
      poaching:      poachingF
    }
  };
}


// ── AREA CALCULATOR ───────────────────────────────────────────
function getAreaKm2(mask, scale) {
  return ee.Number(
    ee.Image.pixelArea().updateMask(mask).reduceRegion({
      reducer: ee.Reducer.sum(), geometry: aoi,
      scale: scale, maxPixels: 1e12, tileScale: 4
    }).get('area')
  ).divide(1e6);
}


// ── UI PANEL ─────────────────────────────────────────────────
var runButton = ui.Button({
  label: 'RUN THREAT ANALYSIS',
  style: {color: 'white', fontWeight: 'bold', padding: '10px'}
});
var statusLabel = ui.Label('Click button after LULC map loads');
var panel = ui.Panel([
  ui.Label('BhoomiRakshak v7.7-hybrid', {fontWeight: 'bold', fontSize: '16px'}),
  ui.Label('DW + RF fusion | 7 threats | hybrid alerts', {fontSize: '11px', color: 'gray'}),
  statusLabel,
  runButton
], ui.Panel.Layout.Flow('vertical'), {position: 'top-right', padding: '8px'});
Map.add(panel);


runButton.onClick(function() {
  statusLabel.setValue('Computing 7 threats...');
  runButton.setDisabled(true);

  var result = buildThreatMap();
  var raw    = result.raw;
  var clean  = result.clean;

  var S  = CONFIG.STATS_SCALE_DEFAULT;
  var SW = CONFIG.STATS_SCALE_WATER;
  var SV = CONFIG.STATS_SCALE_VEG;

  // Stage 1: raw threat areas
  var rawStats = ee.Dictionary({
    defor:  getAreaKm2(raw.select('deforestation'), S),
    veg:    getAreaKm2(raw.select('vegLoss'), SV),
    water:  getAreaKm2(raw.select('waterDeg'), SW),
    urban:  getAreaKm2(raw.select('urbanExp'), S),
    soil:   getAreaKm2(raw.select('soilDeg'), S),
    agri:   getAreaKm2(raw.select('agriLoss'), S),
    poach:  getAreaKm2(raw.select('poaching'), S)
  });

  rawStats.evaluate(function(s) {
    if (!s) {
      statusLabel.setValue('Raw stats failed');
      runButton.setDisabled(false);
      return;
    }

    print('---------------------------------------------');
    print('RAW THREAT DETECTIONS (km2)');
    print('  Deforestation:   ' + (s.defor  || 0).toFixed(1));
    print('  Vegetation Loss: ' + (s.veg    || 0).toFixed(1));
    print('  Water Degrad:    ' + (s.water  || 0).toFixed(1));
    print('  Urban Expansion: ' + (s.urban  || 0).toFixed(1));
    print('  Soil Degrad:     ' + (s.soil   || 0).toFixed(1));
    print('  Agri Loss:       ' + (s.agri   || 0).toFixed(1));
    print('  Poaching Proxy:  ' + (s.poach  || 0).toFixed(1));

    // Stage 2: filtered threat areas + AOI reference
    var filtStats = ee.Dictionary({
      defor:  getAreaKm2(clean.deforestation, S),
      veg:    getAreaKm2(clean.vegLoss, SV),
      water:  getAreaKm2(clean.waterDeg, SW),
      urban:  getAreaKm2(clean.urbanExp, S),
      soil:   getAreaKm2(clean.soilDeg, S),
      agri:   getAreaKm2(clean.agriLoss, S),
      poach:  getAreaKm2(clean.poaching, S),
      aoi_default_km2: getAreaKm2(ee.Image.constant(1).clip(aoi), S),
      aoi_water_km2:   getAreaKm2(ee.Image.constant(1).clip(aoi), SW),
      aoi_veg_km2:     getAreaKm2(ee.Image.constant(1).clip(aoi), SV)
    });

    filtStats.evaluate(function(f) {
      if (!f) {
        statusLabel.setValue('Filtered stats failed');
        runButton.setDisabled(false);
        return;
      }

      var aoiDefaultKm2 = f.aoi_default_km2 || 0;
      var aoiWaterKm2   = f.aoi_water_km2   || aoiDefaultKm2;
      var aoiVegKm2     = f.aoi_veg_km2     || aoiDefaultKm2;

      function pctOfAoi(val, aoiKm2) {
        if (!aoiKm2 || aoiKm2 === 0) return 0;
        return ((val || 0) / aoiKm2) * 100;
      }

      print('---------------------------------------------');
      print('FILTERED THREAT AREAS (km2)');
      print('  Deforestation:   ' + (f.defor  || 0).toFixed(2));
      print('  Vegetation Loss: ' + (f.veg    || 0).toFixed(2));
      print('  Water Degrad:    ' + (f.water  || 0).toFixed(2));
      print('  Urban Expansion: ' + (f.urban  || 0).toFixed(2));
      print('  Soil Degrad:     ' + (f.soil   || 0).toFixed(2));
      print('  Agri Loss:       ' + (f.agri   || 0).toFixed(2));
      print('  Poaching Proxy:  ' + (f.poach  || 0).toFixed(2));

      print('---------------------------------------------');
      print('AOI-NORMALIZED THREATS (% of AOI)');
      print('  Deforestation:   ' + pctOfAoi(f.defor,  aoiDefaultKm2).toFixed(3) + '%');
      print('  Vegetation Loss: ' + pctOfAoi(f.veg,    aoiVegKm2).toFixed(3)     + '%');
      print('  Water Degrad:    ' + pctOfAoi(f.water,  aoiWaterKm2).toFixed(3)   + '%');
      print('  Urban Expansion: ' + pctOfAoi(f.urban,  aoiDefaultKm2).toFixed(3) + '%');
      print('  Soil Degrad:     ' + pctOfAoi(f.soil,   aoiDefaultKm2).toFixed(3) + '%');
      print('  Agri Loss:       ' + pctOfAoi(f.agri,   aoiDefaultKm2).toFixed(3) + '%');
      print('  Poaching Proxy:  ' + pctOfAoi(f.poach,  aoiDefaultKm2).toFixed(3) + '%');

      // Dual-gate alert check
      print('---------------------------------------------');
      var alerts = [];
      function chk(name, val, absThresh, pctThresh, aoiKm2) {
        var v = (val || 0);
        var p = pctOfAoi(v, aoiKm2);
        if (v > absThresh && p > (pctThresh || 0)) {
          var severity = v > absThresh * 3 ? 'HIGH' : (v > absThresh * 2 ? 'MODERATE' : 'LOW');
          alerts.push(name + ': ' + v.toFixed(2) + ' km2 | ' + p.toFixed(3) + '% AOI | ' + severity);
        }
      }
      chk('DEFORESTATION', f.defor, CONFIG.ALERT_DEFOR, CONFIG.ALERT_DEFOR_PCT, aoiDefaultKm2);
      chk('VEG LOSS',      f.veg,   CONFIG.ALERT_VEG,   CONFIG.ALERT_VEG_PCT,   aoiVegKm2);
      chk('WATER',         f.water, CONFIG.ALERT_WATER, CONFIG.ALERT_WATER_PCT, aoiWaterKm2);
      chk('URBAN',         f.urban, CONFIG.ALERT_URBAN, CONFIG.ALERT_URBAN_PCT, aoiDefaultKm2);
      chk('SOIL',          f.soil,  CONFIG.ALERT_SOIL,  CONFIG.ALERT_SOIL_PCT,  aoiDefaultKm2);
      chk('AGRI',          f.agri,  CONFIG.ALERT_AGRI,  CONFIG.ALERT_AGRI_PCT,  aoiDefaultKm2);
      chk('POACHING',      f.poach, CONFIG.ALERT_POACH, CONFIG.ALERT_POACH_PCT, aoiDefaultKm2);

      if (alerts.length > 0) {
        print('ACTIVE ALERTS (' + alerts.length + '/7)');
        alerts.forEach(function(a) { print('  ' + a); });
        statusLabel.setValue('Completed with ' + alerts.length + ' alerts');
      } else {
        print('NO ALERTS');
        statusLabel.setValue('Completed without alerts');
      }

      // Composite threat layer — higher priority threats painted last (on top)
      var threatVis = ee.Image(0)
        .where(clean.agriLoss,      6)
        .where(clean.vegLoss,       2)
        .where(clean.soilDeg,       5)
        .where(clean.urbanExp,      4)
        .where(clean.waterDeg,      3)
        .where(clean.poaching,      7)
        .where(clean.deforestation, 1)
        .clip(aoi).selfMask();

      var threatPal = ['#d73027','#78c679','#2171b5','#9e0142','#f4a460','#ffd700','#ff00ff'];
      Map.addLayer(threatVis, {min: 1, max: 7, palette: threatPal}, 'Threats v7.7-hybrid', true);
      Map.addLayer(clean.deforestation.selfMask(), {palette: ['#d73027']}, 'Deforestation', false);
      Map.addLayer(clean.vegLoss.selfMask(),       {palette: ['#78c679']}, 'Veg Loss',      false);
      Map.addLayer(clean.waterDeg.selfMask(),      {palette: ['#2171b5']}, 'Water',         false);
      Map.addLayer(clean.urbanExp.selfMask(),      {palette: ['#9e0142']}, 'Urban',         false);
      Map.addLayer(clean.soilDeg.selfMask(),       {palette: ['#f4a460']}, 'Soil',          false);
      Map.addLayer(clean.agriLoss.selfMask(),      {palette: ['#ffd700']}, 'Agri',          false);
      Map.addLayer(clean.poaching.selfMask(),      {palette: ['#ff00ff']}, 'Poaching',      false);

      runButton.setDisabled(false);
    });
  });
});


// ── LULC STATS ────────────────────────────────────────────────
var lulcStats = ee.Dictionary({
  forest_km2: getAreaKm2(cls_current.eq(1), CONFIG.STATS_SCALE_DEFAULT),
  shrub_km2:  getAreaKm2(cls_current.eq(2), CONFIG.STATS_SCALE_DEFAULT),
  crop_km2:   getAreaKm2(cls_current.eq(3), CONFIG.STATS_SCALE_DEFAULT),
  urban_km2:  getAreaKm2(cls_current.eq(4), CONFIG.STATS_SCALE_DEFAULT),
  barren_km2: getAreaKm2(cls_current.eq(5), CONFIG.STATS_SCALE_DEFAULT),
  water_km2:  getAreaKm2(cls_current.eq(6), CONFIG.STATS_SCALE_WATER),
  snow_km2:   getAreaKm2(cls_current.eq(7), CONFIG.STATS_SCALE_DEFAULT)
});

lulcStats.evaluate(function(s) {
  if (!s) { print('LULC stats failed'); return; }
  print('---------------------------------------------');
  print('LULC AREAS (km2)  [Hybrid DW + RF]');
  print('  Forest: ' + (s.forest_km2 || 0).toFixed(1));
  print('  Shrub:  ' + (s.shrub_km2  || 0).toFixed(1));
  print('  Crop:   ' + (s.crop_km2   || 0).toFixed(1));
  print('  Urban:  ' + (s.urban_km2  || 0).toFixed(1));
  print('  Barren: ' + (s.barren_km2 || 0).toFixed(1));
  print('  Water:  ' + (s.water_km2  || 0).toFixed(1) + '  [50m scale]');
  print('  Snow:   ' + (s.snow_km2   || 0).toFixed(1));
});


// ── VISUALIZATION ─────────────────────────────────────────────
var lulcPal = ['#1a9850','#74c476','#fed976','#e31a1c','#d4b483','#4575b4','#ffffff'];
Map.addLayer(cls_current,  {min: 1, max: 7, palette: lulcPal}, 'LULC Current (Hybrid)', true);
Map.addLayer(cls_baseline, {min: 1, max: 7, palette: lulcPal}, 'LULC Baseline (Hybrid)', false);

// DW confidence map — shows where RF filled in (dark = RF used, bright = DW used)
Map.addLayer(hybridCurrent.conf,
  {min: 0, max: 1, palette: ['#ff0000','#ffff00','#00aa00']},
  'DW Confidence (green=DW used, red=RF used)', false);

// Pure RF classification for comparison
Map.addLayer(rfClassCurrent, {min: 1, max: 7, palette: lulcPal}, 'LULC RF only (compare)', false);

Map.addLayer(ndvi_delta, {min: -0.4, max: 0.4,
  palette: ['#d73027','#fc8d59','#fee08b','#d9ef8b','#1a9850']}, 'NDVI delta', false);
Map.addLayer(ndbi_delta, {min: -0.3, max: 0.3,
  palette: ['#1a9850','#fee08b','#d73027']}, 'NDBI delta', false);
Map.addLayer(lightIncrease, {min: -2, max: 5,
  palette: ['#000033','#000066','#ffff00','#ff0000']}, 'Night Light delta', false);


// ── LEGEND ────────────────────────────────────────────────────
var legend = ui.Panel({style: {position: 'bottom-left', padding: '6px'}});
legend.add(ui.Label('BhoomiRakshak v7.7-hybrid', {fontWeight: 'bold'}));
legend.add(ui.Label('DW conf >= 0.6: DW used | < 0.6: RF used',
  {fontSize: '10px', color: '#555', margin: '0 0 4px 0'}));

legend.add(ui.Label('LULC', {fontWeight: 'bold', margin: '4px 0 2px 0', fontSize: '11px'}));
[{c:'#1a9850',l:'Forest'},{c:'#74c476',l:'Shrub'},{c:'#fed976',l:'Crop'},
 {c:'#e31a1c',l:'Urban'},{c:'#d4b483',l:'Barren'},{c:'#4575b4',l:'Water'},
 {c:'#ffffff',l:'Snow'}].forEach(function(x) {
  legend.add(ui.Panel([
    ui.Label('',{backgroundColor:x.c,padding:'8px',margin:'1px',border:'1px solid #666'}),
    ui.Label(x.l,{margin:'1px 4px',fontSize:'11px'})
  ], ui.Panel.Layout.Flow('horizontal')));
});

legend.add(ui.Label('Threats', {fontWeight: 'bold', margin: '6px 0 2px 0', fontSize: '11px'}));
[{c:'#d73027',l:'Deforestation'},{c:'#78c679',l:'Veg Loss'},
 {c:'#2171b5',l:'Water'},{c:'#9e0142',l:'Urban'},
 {c:'#f4a460',l:'Soil'},{c:'#ffd700',l:'Agri Loss'},
 {c:'#ff00ff',l:'Poaching'}].forEach(function(x) {
  legend.add(ui.Panel([
    ui.Label('',{backgroundColor:x.c,padding:'8px',margin:'1px',border:'1px solid #666'}),
    ui.Label(x.l,{margin:'1px 4px',fontSize:'11px'})
  ], ui.Panel.Layout.Flow('horizontal')));
});
Map.add(legend);

inputBands.evaluate(function(bands) {
  print('---------------------------------------------');
  print('Input bands (' + bands.length + '): ' + bands.join(', '));
});

print('v7.7-hybrid loaded - DW + RF fusion - click RUN THREAT ANALYSIS');
```

---------------------------------------------

DW confidence diagnostics (mean across AOI)

v7.7-hybrid loaded - DW + RF fusion - click RUN THREAT ANALYSIS

  DW conf current:  0.4546

---------------------------------------------

RF ACCURACY: 80.5%  |  Kappa: 0.766

---------------------------------------------

Input bands (18): B2, B3, B4, B8, B11, B12, NDVI, NDWI, NDBI, NDMI, BSI, EVI, elevation, slope, aspect, VV, VH, VV_VH_ratio

  DW conf baseline: 0.4589

---------------------------------------------

LULC AREAS (km2)  [Hybrid DW + RF]

  Forest: 1787.2

  Shrub:  600.4

  Crop:   354.8

  Urban:  258.4

  Barren: 52.6

  Water:  18.5  [50m scale]

  Snow:   0.0

---------------------------------------------

RAW THREAT DETECTIONS (km2)

  Deforestation:   34.9

  Vegetation Loss: 17.5

  Water Degrad:    1.9

  Urban Expansion: 26.4

  Soil Degrad:     12.9

  Agri Loss:       11.4

  Poaching Proxy:  1.7

---------------------------------------------

FILTERED THREAT AREAS (km2)

  Deforestation:   10.06

  Vegetation Loss: 8.48

  Water Degrad:    1.89

  Urban Expansion: 6.75

  Soil Degrad:     3.55

  Agri Loss:       8.13

  Poaching Proxy:  0.27

---------------------------------------------

AOI-NORMALIZED THREATS (% of AOI)

  Deforestation:   0.328%

  Vegetation Loss: 0.277%

  Water Degrad:    0.062%

  Urban Expansion: 0.220%

  Soil Degrad:     0.116%

  Agri Loss:       0.265%

  Poaching Proxy:  0.009%

---------------------------------------------

ACTIVE ALERTS (1/7)

  WATER: 1.89 km2 | 0.062% AOI | LOW