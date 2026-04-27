import assert from "node:assert/strict";
import test from "node:test";
function pickFallbackDefault(profiles, removedId) {
    const candidates = profiles.filter((profile) => profile.id !== removedId);
    if (candidates.length === 0) {
        return null;
    }
    candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return candidates[0]?.id ?? null;
}
test("pickFallbackDefault returns most recently updated profile", () => {
    const profiles = [
        { id: "p1", isDefault: false, updatedAt: new Date("2026-04-10T10:00:00.000Z") },
        { id: "p2", isDefault: true, updatedAt: new Date("2026-04-11T10:00:00.000Z") },
        { id: "p3", isDefault: false, updatedAt: new Date("2026-04-12T10:00:00.000Z") }
    ];
    assert.equal(pickFallbackDefault(profiles, "p2"), "p3");
});
test("pickFallbackDefault returns null when no candidates exist", () => {
    const profiles = [{ id: "p1", isDefault: true, updatedAt: new Date("2026-04-11T10:00:00.000Z") }];
    assert.equal(pickFallbackDefault(profiles, "p1"), null);
});
//# sourceMappingURL=thresholdProfilesLogic.test.js.map