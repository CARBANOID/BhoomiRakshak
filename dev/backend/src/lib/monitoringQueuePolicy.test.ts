import assert from "node:assert/strict";
import test from "node:test";
import {
	advanceByCadence,
	buildFailureMessage,
	computeRetryDelayMs,
	extractModelStatusCode,
	inspectRetryableError,
	resolveNextRunAt
} from "./monitoringQueuePolicy.js";

test("advanceByCadence advances daily by one UTC day", () => {
	const start = new Date("2026-04-20T10:00:00.000Z");
	const next = advanceByCadence(start, "daily");
	assert.equal(next.toISOString(), "2026-04-21T10:00:00.000Z");
});

test("advanceByCadence advances weekly by seven UTC days", () => {
	const start = new Date("2026-04-20T10:00:00.000Z");
	const next = advanceByCadence(start, "weekly");
	assert.equal(next.toISOString(), "2026-04-27T10:00:00.000Z");
});

test("resolveNextRunAt rolls stale daily schedule to the first date after now", () => {
	const previousNextRunAt = new Date("2026-04-01T00:00:00.000Z");
	const now = new Date("2026-04-05T10:00:00.000Z");
	const resolved = resolveNextRunAt(previousNextRunAt, "daily", now);
	assert.equal(resolved.toISOString(), "2026-04-06T00:00:00.000Z");
});

test("resolveNextRunAt rolls stale weekly schedule forward correctly", () => {
	const previousNextRunAt = new Date("2026-04-01T00:00:00.000Z");
	const now = new Date("2026-04-20T10:00:00.000Z");
	const resolved = resolveNextRunAt(previousNextRunAt, "weekly", now);
	assert.equal(resolved.toISOString(), "2026-04-22T00:00:00.000Z");
});

test("computeRetryDelayMs applies exponential backoff and cap", () => {
	assert.equal(computeRetryDelayMs(1, 5000, 60000, 0, () => 0), 5000);
	assert.equal(computeRetryDelayMs(3, 5000, 60000, 0, () => 0), 20000);
	assert.equal(computeRetryDelayMs(6, 5000, 60000, 0, () => 0), 60000);
});

test("computeRetryDelayMs applies jitter when configured", () => {
	const withJitter = computeRetryDelayMs(2, 5000, 60000, 500, () => 0.9);
	assert.equal(withJitter, 10450);
});

test("extractModelStatusCode parses model service status code", () => {
	assert.equal(extractModelStatusCode("model service failed with 503: upstream unavailable"), 503);
	assert.equal(extractModelStatusCode("unexpected error"), null);
});

test("inspectRetryableError marks retryable HTTP errors", () => {
	const retryable = inspectRetryableError(new Error("model service failed with 503: gateway"));
	assert.equal(retryable.retryable, true);
	assert.equal(retryable.reason, "http-503");
	assert.equal(retryable.statusCode, 503);

	const nonRetryable = inspectRetryableError(new Error("model service failed with 400: bad request"));
	assert.equal(nonRetryable.retryable, false);
	assert.equal(nonRetryable.reason, "http-400");
	assert.equal(nonRetryable.statusCode, 400);
});

test("inspectRetryableError marks abort and network failures as retryable", () => {
	const abortError = new Error("request aborted");
	abortError.name = "AbortError";
	const abortInspection = inspectRetryableError(abortError);
	assert.equal(abortInspection.retryable, true);
	assert.equal(abortInspection.reason, "abort-timeout");

	const networkInspection = inspectRetryableError(new Error("fetch failed: ECONNREFUSED"));
	assert.equal(networkInspection.retryable, true);
	assert.equal(networkInspection.reason, "network");
});

test("buildFailureMessage appends details and supports string errors", () => {
	assert.equal(buildFailureMessage("plain error", "extra=1"), "plain error | extra=1");
	assert.equal(buildFailureMessage(new Error("boom")), "boom");
});
