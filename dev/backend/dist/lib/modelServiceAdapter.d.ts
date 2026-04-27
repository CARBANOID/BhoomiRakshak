import zod from "zod";
declare const metricSchema: zod.ZodObject<{
    threatType: zod.ZodString;
    rawAreaKm2: zod.ZodOptional<zod.ZodNumber>;
    filteredAreaKm2: zod.ZodOptional<zod.ZodNumber>;
    percentOfAoi: zod.ZodOptional<zod.ZodNumber>;
    triggered: zod.ZodOptional<zod.ZodBoolean>;
    severity: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
}, zod.z.core.$strict>;
declare const alertSchema: zod.ZodObject<{
    threatType: zod.ZodString;
    severity: zod.ZodString;
    areaKm2: zod.ZodOptional<zod.ZodNumber>;
    percentOfAoi: zod.ZodOptional<zod.ZodNumber>;
    message: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
}, zod.z.core.$strict>;
declare const reportSchema: zod.ZodObject<{
    summary: zod.ZodUnknown;
    details: zod.ZodOptional<zod.ZodUnknown>;
}, zod.z.core.$strict>;
type ModelMetric = zod.infer<typeof metricSchema>;
type ModelAlert = zod.infer<typeof alertSchema>;
type ModelReport = zod.infer<typeof reportSchema>;
export type ModelServiceRunPayload = {
    runId: string;
    userId: string;
    runDateIso: string;
    aoi: {
        id: string;
        name: string;
        geometry: unknown;
    };
    baseline: {
        mode: string | null;
        years: number | null;
        lagYears: number | null;
    };
    thresholdProfile: {
        id: string;
        name: string;
        mode: string;
        config: unknown;
    } | null;
    configOverrides: unknown;
};
export type ModelServiceRunResult = {
    status: "succeeded" | "failed";
    errorMessage?: string;
    metrics: ModelMetric[];
    alerts: ModelAlert[];
    report?: ModelReport;
};
export declare function invokeModelService(payload: ModelServiceRunPayload): Promise<ModelServiceRunResult>;
export {};
//# sourceMappingURL=modelServiceAdapter.d.ts.map