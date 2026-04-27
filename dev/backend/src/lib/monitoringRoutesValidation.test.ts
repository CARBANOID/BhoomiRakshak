import assert from "node:assert/strict";
import test from "node:test";

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	if (typeof raw === "undefined") {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
		throw new Error(`value must be between ${min} and ${max}`);
	}
	return parsed;
}

function normalizeSort(raw: string | undefined): "asc" | "desc" {
	if (typeof raw === "string" && raw.toLowerCase() === "asc") {
		return "asc";
	}
	return "desc";
}

test("parsePositiveInt returns fallback when undefined", () => {
	assert.equal(parsePositiveInt(undefined, 50, 1, 200), 50);
});

test("parsePositiveInt accepts value within bounds", () => {
	assert.equal(parsePositiveInt("20", 50, 1, 200), 20);
});

test("parsePositiveInt throws for invalid range", () => {
	assert.throws(() => parsePositiveInt("0", 50, 1, 200));
	assert.throws(() => parsePositiveInt("300", 50, 1, 200));
});

test("normalizeSort defaults to desc", () => {
	assert.equal(normalizeSort(undefined), "desc");
	assert.equal(normalizeSort("invalid"), "desc");
});

test("normalizeSort accepts asc", () => {
	assert.equal(normalizeSort("asc"), "asc");
	assert.equal(normalizeSort("ASC"), "asc");
});
