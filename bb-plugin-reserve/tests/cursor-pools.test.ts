import assert from "node:assert/strict";
import test from "node:test";
import { cursorModelWindows, CURSOR_MODELS_LABEL, OTHER_MODELS_LABEL } from "../lib/cursor-pools.ts";

test("Cursor dashboard usage splits into Cursor models and Other models", () => {
  const windows = cursorModelWindows({
    billingCycleEnd: "1791023511000",
    planUsage: {
      autoPercentUsed: 78.845,
      apiPercentUsed: 100,
      totalPercentUsed: 80.21,
    },
  });

  assert.deepEqual(
    windows.map((window) => ({ label: window.label, usedPercent: window.usedPercent })),
    [
      { label: CURSOR_MODELS_LABEL, usedPercent: 78.845 },
      { label: OTHER_MODELS_LABEL, usedPercent: 100 },
    ],
  );
  assert.equal(windows[0]?.resetsAt, "2026-10-03T10:31:51.000Z");
  assert.equal(windows.some((window) => window.label === "Plan usage"), false);
});

test("missing Cursor pool fields are omitted instead of invented", () => {
  assert.deepEqual(cursorModelWindows({ planUsage: { totalPercentUsed: 20 } }), []);
  assert.equal(cursorModelWindows({ planUsage: { autoPercentUsed: 12 } })[0]?.label, CURSOR_MODELS_LABEL);
});
