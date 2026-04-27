import zod from "zod";
const jsonValueSchema = zod.lazy(() => zod.union([
    zod.string(),
    zod.number(),
    zod.boolean(),
    zod.null(),
    zod.array(jsonValueSchema),
    zod.record(zod.string(), jsonValueSchema)
]));
const passwordSchema = zod
    .string()
    .min(8, "password should have min 8 characters")
    .max(30, "password can have max 30 characters")
    .refine((password) => /[A-Z]/.test(password), {
    message: "password should have atleast 1 uppercase letter"
})
    .refine((password) => /[a-z]/.test(password), {
    message: "password should have atleast 1 lowercase letter"
})
    .refine((password) => /[0-9]/.test(password), {
    message: "password should have atleast 1 digit"
})
    .refine((password) => /[!@#$%^&*]/.test(password), {
    message: "password should have atleast 1 specialcase letter"
});
export const zodSignUpSchema = zod.strictObject({
    username: zod
        .string()
        .min(3, "username should have min 3 characters")
        .max(30, "username can have max 30 characters"),
    email: zod.string().email().max(50, "email can have max 50 characters"),
    photoUrl: zod.string().max(255, "photoUrl can have max 255 characters").optional(),
    password: passwordSchema
});
export const zodSignInSchema = zod.strictObject({
    email: zod.string().email().max(50, "email can have max 50 characters"),
    password: passwordSchema
});
const coordinateSchema = zod.tuple([
    zod.number().min(-180, "longitude out of range").max(180, "longitude out of range"),
    zod.number().min(-90, "latitude out of range").max(90, "latitude out of range")
]);
function isClosedRing(ring) {
    if (ring.length < 4) {
        return false;
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last) {
        return false;
    }
    const [firstLng, firstLat] = first;
    const [lastLng, lastLat] = last;
    return firstLng === lastLng && firstLat === lastLat;
}
const linearRingSchema = zod.array(coordinateSchema).min(4, "ring needs at least 4 points").refine(isClosedRing, {
    message: "ring must be closed (first and last coordinate must match)"
});
const polygonCoordinatesSchema = zod.array(linearRingSchema).min(1, "polygon must contain at least one ring");
const multiPolygonCoordinatesSchema = zod.array(polygonCoordinatesSchema).min(1, "multipolygon must contain at least one polygon");
export const zodAoiGeometrySchema = zod.union([
    zod.strictObject({
        type: zod.literal("Polygon"),
        coordinates: polygonCoordinatesSchema
    }),
    zod.strictObject({
        type: zod.literal("MultiPolygon"),
        coordinates: multiPolygonCoordinatesSchema
    })
]);
export const zodAoiSourceType = zod.enum(["rectangle", "circle", "polygon", "manual", "bbox"]);
export const zodCreateAoiSchema = zod.strictObject({
    name: zod.string().min(1, "name is required").max(120, "name can have max 120 characters"),
    geometry: zodAoiGeometrySchema,
    sourceType: zodAoiSourceType.optional(),
    metadata: zod.record(zod.string(), jsonValueSchema).optional()
});
export const zodUpdateAoiSchema = zod
    .strictObject({
    name: zod.string().min(1, "name is required").max(120, "name can have max 120 characters").optional(),
    geometry: zodAoiGeometrySchema.optional(),
    sourceType: zodAoiSourceType.optional(),
    metadata: zod.record(zod.string(), jsonValueSchema).optional()
})
    .refine((payload) => Object.values(payload).some((value) => typeof value !== "undefined"), {
    message: "at least one field must be provided for update"
});
export const zodRunStatus = zod.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
const thresholdProfileModes = ["strict", "balanced", "permissive", "custom"];
const thresholdConfigAllowedKeys = [
    "CLOUD_STRICT",
    "CLOUD_RELAXED",
    "BASELINE_YEARS",
    "BASELINE_LAG_YEARS",
    "FIXED_BASELINE_START_YEAR",
    "FIXED_BASELINE_END_YEAR",
    "SEASON_HALF_WINDOW_MONTHS",
    "CURRENT_LOOKBACK_MONTHS",
    "CURRENT_FORWARD_MONTHS",
    "DW_MIN_CONFIDENCE",
    "STATS_SCALE_DEFAULT",
    "STATS_SCALE_WATER",
    "STATS_SCALE_VEG",
    "DEFOR_NDVI_FLOOR",
    "DEFOR_EVI_FLOOR",
    "DEFOR_DROP_HIGH",
    "DEFOR_DROP_MEDIUM",
    "VEG_NDVI_FLOOR",
    "VEG_DROP_HIGH",
    "VEG_DROP_MEDIUM",
    "WATER_NDWI_FLOOR",
    "WATER_DROP_HIGH",
    "WATER_DROP_MEDIUM",
    "URBAN_NDBI_HIGH",
    "URBAN_NDBI_MEDIUM",
    "SOIL_BSI_HIGH",
    "SOIL_BSI_MEDIUM",
    "AGRI_NDVI_DROP",
    "POACH_LIGHT_RISE",
    "POACH_NDVI_DROP",
    "CLEAN_DEFOR_MIN_FRAC",
    "CLEAN_VEG_MIN_FRAC",
    "CLEAN_URBAN_MIN_FRAC",
    "CLEAN_SOIL_MIN_FRAC",
    "CLEAN_AGRI_MIN_FRAC",
    "CLEAN_POACH_MIN_FRAC",
    "ALERT_DEFOR",
    "ALERT_URBAN",
    "ALERT_WATER",
    "ALERT_AGRI",
    "ALERT_POACH",
    "ALERT_SOIL",
    "ALERT_VEG",
    "ALERT_DEFOR_PCT",
    "ALERT_VEG_PCT",
    "ALERT_WATER_PCT",
    "ALERT_URBAN_PCT",
    "ALERT_SOIL_PCT",
    "ALERT_AGRI_PCT",
    "ALERT_POACH_PCT",
    "deforestationAreaKm2",
    "deforestationPct",
    "vegLossAreaKm2",
    "vegLossPct",
    "waterDegAreaKm2",
    "waterDegPct",
    "urbanExpAreaKm2",
    "urbanExpPct",
    "soilDegAreaKm2",
    "soilDegPct",
    "agriLossAreaKm2",
    "agriLossPct",
    "poachingAreaKm2",
    "poachingPct",
    "baselineYears",
    "baselineLagYears",
    "fixedBaselineStartYear",
    "fixedBaselineEndYear",
    "dwMinConfidence",
    "statsScaleDefault",
    "statsScaleWater",
    "statsScaleVeg"
];
const thresholdConfigAllowedKeySet = new Set(thresholdConfigAllowedKeys);
export const zodThresholdConfigSchema = zod.record(zod.string(), zod.number().finite()).superRefine((config, ctx) => {
    for (const key of Object.keys(config)) {
        if (!thresholdConfigAllowedKeySet.has(key)) {
            ctx.addIssue({
                code: zod.ZodIssueCode.custom,
                message: `unsupported threshold config key: ${key}`,
                path: [key]
            });
        }
    }
});
const zodThresholdConfigNonEmptySchema = zodThresholdConfigSchema.refine((config) => Object.keys(config).length > 0, "config must include at least one threshold key");
export const zodCreateThresholdProfileSchema = zod.strictObject({
    name: zod.string().trim().min(1, "name is required").max(120, "name can have max 120 characters"),
    mode: zod.enum(thresholdProfileModes).optional(),
    config: zodThresholdConfigNonEmptySchema,
    isDefault: zod.boolean().optional()
});
export const zodUpdateThresholdProfileSchema = zod
    .strictObject({
    name: zod.string().trim().min(1, "name is required").max(120, "name can have max 120 characters").optional(),
    mode: zod.enum(thresholdProfileModes).optional(),
    config: zodThresholdConfigNonEmptySchema.optional(),
    isDefault: zod.boolean().optional()
})
    .refine((payload) => Object.values(payload).some((value) => typeof value !== "undefined"), {
    message: "at least one field must be provided for update"
});
export const zodCreateMonitoringRunSchema = zod.strictObject({
    aoiId: zod.string().uuid("aoiId must be a UUID"),
    runDate: zod.string().datetime().optional(),
    baselineMode: zod.enum(["rolling", "fixed"]).optional(),
    baselineYears: zod.number().int().min(1).max(20).optional(),
    baselineLagYears: zod.number().int().min(0).max(10).optional(),
    thresholdProfileId: zod.string().uuid().optional(),
    configOverrides: zod.record(zod.string(), zod.number()).optional()
});
export const zodCreateScheduleSchema = zod.strictObject({
    aoiId: zod.string().uuid("aoiId must be a UUID"),
    cadence: zod.enum(["daily", "weekly"]),
    nextRunAt: zod.string().datetime(),
    configSnapshot: zod.record(zod.string(), jsonValueSchema).optional()
});
export const zodAlertStatus = zod.enum(["active", "resolved"]);
export const zodUpdateNotificationPreferenceSchema = zod
    .strictObject({
    emailEnabled: zod.boolean().optional(),
    criticalOnly: zod.boolean().optional(),
    digestCadence: zod.enum(["off", "daily", "weekly"]).optional()
})
    .refine((payload) => Object.values(payload).some((value) => typeof value !== "undefined"), {
    message: "at least one field must be provided for update"
});
export const zodCreateNotificationAuditSchema = zod.strictObject({
    channel: zod.enum(["email", "sms", "inapp", "webhook"]),
    category: zod.enum(["alert", "report", "system", "schedule"]),
    target: zod.string().trim().min(1, "target is required").max(255, "target can have max 255 characters"),
    subject: zod.string().trim().min(1, "subject is required").max(180, "subject can have max 180 characters"),
    body: zod.string().trim().min(1, "body is required").max(10_000, "body can have max 10000 characters"),
    status: zod.enum(["queued", "sent", "failed"]).optional(),
    errorMessage: zod.string().max(500, "errorMessage can have max 500 characters").optional(),
    metadata: zod.record(zod.string(), jsonValueSchema).optional()
});
//# sourceMappingURL=zodSchema.js.map