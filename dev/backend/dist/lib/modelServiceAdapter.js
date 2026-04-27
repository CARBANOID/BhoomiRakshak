import zod from "zod";
const metricSchema = zod.strictObject({
    threatType: zod.string().min(1),
    rawAreaKm2: zod.number().finite().nonnegative().optional(),
    filteredAreaKm2: zod.number().finite().nonnegative().optional(),
    percentOfAoi: zod.number().finite().nonnegative().optional(),
    triggered: zod.boolean().optional(),
    severity: zod.string().min(1).nullable().optional()
});
const alertSchema = zod.strictObject({
    threatType: zod.string().min(1),
    severity: zod.string().min(1),
    areaKm2: zod.number().finite().nonnegative().optional(),
    percentOfAoi: zod.number().finite().nonnegative().optional(),
    message: zod.string().nullable().optional()
});
const reportSchema = zod.strictObject({
    summary: zod.unknown(),
    details: zod.unknown().optional()
});
const modelServiceResponseSchema = zod
    .strictObject({
    status: zod.enum(["succeeded", "failed"]).optional(),
    errorMessage: zod.string().nullable().optional(),
    metrics: zod.array(metricSchema).default([]),
    alerts: zod.array(alertSchema).default([]),
    report: reportSchema.optional()
})
    .passthrough();
export async function invokeModelService(payload) {
    const modelServiceUrl = process.env.MODEL_SERVICE_URL ?? "http://127.0.0.1:8000";
    const modelServiceRunPath = process.env.MODEL_SERVICE_RUN_PATH ?? "/monitoring/run";
    const timeoutMs = Number(process.env.MODEL_SERVICE_TIMEOUT_MS ?? 180000);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
        controller.abort();
    }, timeoutMs);
    try {
        const response = await fetch(new URL(modelServiceRunPath, modelServiceUrl), {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`model service failed with ${response.status}: ${body.slice(0, 500)}`);
        }
        const rawBody = await response.json();
        const parsed = modelServiceResponseSchema.safeParse(rawBody);
        if (!parsed.success) {
            throw new Error(`invalid model response: ${parsed.error.message}`);
        }
        const result = {
            status: parsed.data.status ?? "succeeded",
            metrics: parsed.data.metrics,
            alerts: parsed.data.alerts
        };
        if (typeof parsed.data.errorMessage === "string") {
            result.errorMessage = parsed.data.errorMessage;
        }
        if (typeof parsed.data.report !== "undefined") {
            result.report = parsed.data.report;
        }
        return result;
    }
    finally {
        clearTimeout(timeoutHandle);
    }
}
//# sourceMappingURL=modelServiceAdapter.js.map