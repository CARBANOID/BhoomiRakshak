import assert from "node:assert/strict";
import test from "node:test";
import { selectAlertsForPreference } from "./notificationDelivery.js";
test("selectAlertsForPreference keeps all alerts when criticalOnly is false", () => {
    const alerts = [
        { severity: "high", id: 1 },
        { severity: "medium", id: 2 },
        { severity: "critical", id: 3 }
    ];
    const selected = selectAlertsForPreference(alerts, false);
    assert.equal(selected.length, 3);
});
test("selectAlertsForPreference keeps high and critical when criticalOnly is true", () => {
    const alerts = [
        { severity: "low", id: 1 },
        { severity: "medium", id: 2 },
        { severity: "high", id: 3 },
        { severity: "critical", id: 4 }
    ];
    const selected = selectAlertsForPreference(alerts, true);
    assert.deepEqual(selected.map((item) => item.id), [3, 4]);
});
//# sourceMappingURL=notificationDelivery.test.js.map