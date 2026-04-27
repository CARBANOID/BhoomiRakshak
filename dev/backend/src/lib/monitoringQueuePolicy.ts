export type RetryInspection = {
	message: string;
	retryable: boolean;
	reason: string;
	statusCode?: number;
};

export function buildFailureMessage(error: unknown, details?: string): string {
	let message: string;
	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === "string") {
		message = error;
	} else {
		message = "monitoring run failed due to unknown error";
	}

	if (details) {
		return `${message} | ${details}`.slice(0, 1900);
	}

	return message.slice(0, 1900);
}

export function advanceByCadence(date: Date, cadence: string): Date {
	const next = new Date(date);
	if (cadence === "weekly") {
		next.setUTCDate(next.getUTCDate() + 7);
		return next;
	}

	next.setUTCDate(next.getUTCDate() + 1);
	return next;
}

export function resolveNextRunAt(previousNextRunAt: Date, cadence: string, now: Date): Date {
	let next = advanceByCadence(previousNextRunAt, cadence);
	let guard = 0;

	while (next <= now && guard < 400) {
		next = advanceByCadence(next, cadence);
		guard += 1;
	}

	if (next <= now) {
		return advanceByCadence(now, cadence);
	}

	return next;
}

export function computeRetryDelayMs(
	attempt: number,
	baseMs: number,
	maxMs: number,
	jitterMs: number,
	random: () => number = Math.random
): number {
	const exponent = Math.max(0, attempt - 1);
	const backoff = Math.min(maxMs, baseMs * 2 ** exponent);
	const jitter = jitterMs > 0 ? Math.floor(random() * (jitterMs + 1)) : 0;
	return backoff + jitter;
}

export function extractModelStatusCode(errorMessage: string): number | null {
	const match = errorMessage.match(/model service failed with\s+(\d{3})/i);
	if (!match) {
		return null;
	}

	const statusCode = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(statusCode)) {
		return null;
	}

	return statusCode;
}

export function inspectRetryableError(error: unknown): RetryInspection {
	const message = buildFailureMessage(error);
	const lowered = message.toLowerCase();
	const statusCode = extractModelStatusCode(message);

	if (statusCode !== null) {
		if ([408, 429, 500, 502, 503, 504].includes(statusCode)) {
			return {
				message,
				retryable: true,
				reason: `http-${statusCode}`,
				statusCode
			};
		}

		return {
			message,
			retryable: false,
			reason: `http-${statusCode}`,
			statusCode
		};
	}

	if (error instanceof Error && error.name === "AbortError") {
		return {
			message,
			retryable: true,
			reason: "abort-timeout"
		};
	}

	if (
		lowered.includes("fetch failed") ||
		lowered.includes("timeout") ||
		lowered.includes("timed out") ||
		lowered.includes("econnrefused") ||
		lowered.includes("econnreset") ||
		lowered.includes("enotfound") ||
		lowered.includes("eai_again") ||
		lowered.includes("network")
	) {
		return {
			message,
			retryable: true,
			reason: "network"
		};
	}

	return {
		message,
		retryable: false,
		reason: "non-retryable"
	};
}
