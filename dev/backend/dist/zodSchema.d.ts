import zod from "zod";
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare const zodSignUpSchema: zod.ZodObject<{
    username: zod.ZodString;
    email: zod.ZodString;
    photoUrl: zod.ZodOptional<zod.ZodString>;
    password: zod.ZodString;
}, zod.z.core.$strict>;
export declare const zodSignInSchema: zod.ZodObject<{
    email: zod.ZodString;
    password: zod.ZodString;
}, zod.z.core.$strict>;
export declare const zodAoiGeometrySchema: zod.ZodUnion<readonly [zod.ZodObject<{
    type: zod.ZodLiteral<"Polygon">;
    coordinates: zod.ZodArray<zod.ZodArray<zod.ZodTuple<[zod.ZodNumber, zod.ZodNumber], null>>>;
}, zod.z.core.$strict>, zod.ZodObject<{
    type: zod.ZodLiteral<"MultiPolygon">;
    coordinates: zod.ZodArray<zod.ZodArray<zod.ZodArray<zod.ZodTuple<[zod.ZodNumber, zod.ZodNumber], null>>>>;
}, zod.z.core.$strict>]>;
export declare const zodAoiSourceType: zod.ZodEnum<{
    rectangle: "rectangle";
    circle: "circle";
    polygon: "polygon";
    manual: "manual";
    bbox: "bbox";
}>;
export declare const zodCreateAoiSchema: zod.ZodObject<{
    name: zod.ZodString;
    geometry: zod.ZodUnion<readonly [zod.ZodObject<{
        type: zod.ZodLiteral<"Polygon">;
        coordinates: zod.ZodArray<zod.ZodArray<zod.ZodTuple<[zod.ZodNumber, zod.ZodNumber], null>>>;
    }, zod.z.core.$strict>, zod.ZodObject<{
        type: zod.ZodLiteral<"MultiPolygon">;
        coordinates: zod.ZodArray<zod.ZodArray<zod.ZodArray<zod.ZodTuple<[zod.ZodNumber, zod.ZodNumber], null>>>>;
    }, zod.z.core.$strict>]>;
    sourceType: zod.ZodOptional<zod.ZodEnum<{
        rectangle: "rectangle";
        circle: "circle";
        polygon: "polygon";
        manual: "manual";
        bbox: "bbox";
    }>>;
    metadata: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodType<JsonValue, unknown, zod.z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, zod.z.core.$strict>;
export declare const zodUpdateAoiSchema: zod.ZodObject<{
    name: zod.ZodOptional<zod.ZodString>;
    geometry: zod.ZodOptional<zod.ZodUnion<readonly [zod.ZodObject<{
        type: zod.ZodLiteral<"Polygon">;
        coordinates: zod.ZodArray<zod.ZodArray<zod.ZodTuple<[zod.ZodNumber, zod.ZodNumber], null>>>;
    }, zod.z.core.$strict>, zod.ZodObject<{
        type: zod.ZodLiteral<"MultiPolygon">;
        coordinates: zod.ZodArray<zod.ZodArray<zod.ZodArray<zod.ZodTuple<[zod.ZodNumber, zod.ZodNumber], null>>>>;
    }, zod.z.core.$strict>]>>;
    sourceType: zod.ZodOptional<zod.ZodEnum<{
        rectangle: "rectangle";
        circle: "circle";
        polygon: "polygon";
        manual: "manual";
        bbox: "bbox";
    }>>;
    metadata: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodType<JsonValue, unknown, zod.z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, zod.z.core.$strict>;
export declare const zodRunStatus: zod.ZodEnum<{
    succeeded: "succeeded";
    failed: "failed";
    queued: "queued";
    running: "running";
    cancelled: "cancelled";
}>;
export declare const zodThresholdConfigSchema: zod.ZodRecord<zod.ZodString, zod.ZodNumber>;
export declare const zodCreateThresholdProfileSchema: zod.ZodObject<{
    name: zod.ZodString;
    mode: zod.ZodOptional<zod.ZodEnum<{
        custom: "custom";
        strict: "strict";
        balanced: "balanced";
        permissive: "permissive";
    }>>;
    config: zod.ZodRecord<zod.ZodString, zod.ZodNumber>;
    isDefault: zod.ZodOptional<zod.ZodBoolean>;
}, zod.z.core.$strict>;
export declare const zodUpdateThresholdProfileSchema: zod.ZodObject<{
    name: zod.ZodOptional<zod.ZodString>;
    mode: zod.ZodOptional<zod.ZodEnum<{
        custom: "custom";
        strict: "strict";
        balanced: "balanced";
        permissive: "permissive";
    }>>;
    config: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodNumber>>;
    isDefault: zod.ZodOptional<zod.ZodBoolean>;
}, zod.z.core.$strict>;
export declare const zodCreateMonitoringRunSchema: zod.ZodObject<{
    aoiId: zod.ZodString;
    runDate: zod.ZodOptional<zod.ZodString>;
    baselineMode: zod.ZodOptional<zod.ZodEnum<{
        fixed: "fixed";
        rolling: "rolling";
    }>>;
    baselineYears: zod.ZodOptional<zod.ZodNumber>;
    baselineLagYears: zod.ZodOptional<zod.ZodNumber>;
    thresholdProfileId: zod.ZodOptional<zod.ZodString>;
    configOverrides: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodNumber>>;
}, zod.z.core.$strict>;
export declare const zodCreateScheduleSchema: zod.ZodObject<{
    aoiId: zod.ZodString;
    cadence: zod.ZodEnum<{
        weekly: "weekly";
        daily: "daily";
    }>;
    nextRunAt: zod.ZodString;
    configSnapshot: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodType<JsonValue, unknown, zod.z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, zod.z.core.$strict>;
export declare const zodAlertStatus: zod.ZodEnum<{
    active: "active";
    resolved: "resolved";
}>;
export declare const zodUpdateNotificationPreferenceSchema: zod.ZodObject<{
    emailEnabled: zod.ZodOptional<zod.ZodBoolean>;
    criticalOnly: zod.ZodOptional<zod.ZodBoolean>;
    digestCadence: zod.ZodOptional<zod.ZodEnum<{
        off: "off";
        weekly: "weekly";
        daily: "daily";
    }>>;
}, zod.z.core.$strict>;
export declare const zodCreateNotificationAuditSchema: zod.ZodObject<{
    channel: zod.ZodEnum<{
        email: "email";
        sms: "sms";
        inapp: "inapp";
        webhook: "webhook";
    }>;
    category: zod.ZodEnum<{
        report: "report";
        alert: "alert";
        system: "system";
        schedule: "schedule";
    }>;
    target: zod.ZodString;
    subject: zod.ZodString;
    body: zod.ZodString;
    status: zod.ZodOptional<zod.ZodEnum<{
        failed: "failed";
        queued: "queued";
        sent: "sent";
    }>>;
    errorMessage: zod.ZodOptional<zod.ZodString>;
    metadata: zod.ZodOptional<zod.ZodRecord<zod.ZodString, zod.ZodType<JsonValue, unknown, zod.z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, zod.z.core.$strict>;
export {};
//# sourceMappingURL=zodSchema.d.ts.map