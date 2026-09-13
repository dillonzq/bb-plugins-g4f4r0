import { it, expect } from "vitest";
import { commandOutput, recoverCommandOutput } from "../src/command-output";
it("preserves failed batch steps while removing runtime lifecycle noise", () => {
  const raw = JSON.stringify([
    {
      success: true,
      result: { filled: "field", lifecycle: { secret: "irrelevant" } },
    },
    { success: false, error: "covered" },
  ]);
  const out = JSON.parse(recoverCommandOutput(new Error(raw)));
  expect(out).toEqual([
    { success: true, result: { filled: "field" } },
    { success: false, error: "covered" },
  ]);
});
it("reports command failure messages without JSON wrappers", () => {
  expect(() =>
    commandOutput('{"success":false,"error":"Field missing"}'),
  ).toThrow("Field missing");
});
it("does not hide process failures that are not command JSON", () => {
  expect(() => recoverCommandOutput(new Error("Cancelled"))).toThrow(
    "Cancelled",
  );
});
