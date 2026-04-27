export type RetryInspection = {
    message: string;
    retryable: boolean;
    reason: string;
    statusCode?: number;
};
export declare function buildFailureMessage(error: unknown, details?: string): string;
export declare function advanceByCadence(date: Date, cadence: string): Date;
export declare function resolveNextRunAt(previousNextRunAt: Date, cadence: string, now: Date): Date;
export declare function computeRetryDelayMs(attempt: number, baseMs: number, maxMs: number, jitterMs: number, random?: () => number): number;
export declare function extractModelStatusCode(errorMessage: string): number | null;
export declare function inspectRetryableError(error: unknown): RetryInspection;
//# sourceMappingURL=monitoringQueuePolicy.d.ts.map