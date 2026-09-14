import assert from "node:assert/strict";
import test from "node:test";
import {
  createResetActionGate,
  type ResetConsumptionOutcome,
} from "../lib/reset-action-gate.ts";

test("preparing a reset never invokes the consuming callback", async () => {
  let calls = 0;
  const gate = createResetActionGate(async (): Promise<ResetConsumptionOutcome> => {
    calls += 1;
    return "reset";
  });
  gate.setAvailableCount(2);

  const prepared = gate.prepare();
  assert.equal(prepared.outcome, "ready");
  assert.equal(calls, 0);
  if (prepared.outcome !== "ready") assert.fail("reset should be ready");

  const outcome = await gate.consume(prepared.confirmationToken);
  assert.equal(outcome, "reset");
  assert.equal(calls, 1);
});

test("reset confirmation is one-shot and idempotent", async () => {
  let calls = 0;
  const gate = createResetActionGate(async (): Promise<ResetConsumptionOutcome> => {
    calls += 1;
    return "alreadyRedeemed";
  });
  gate.setAvailableCount(1);
  const prepared = gate.prepare();
  if (prepared.outcome !== "ready") assert.fail("reset should be ready");

  assert.equal(await gate.consume(prepared.confirmationToken), "alreadyRedeemed");
  assert.equal(await gate.consume(prepared.confirmationToken), "alreadyRedeemed");
  assert.equal(calls, 1);
});

test("reset confirmation expires without invoking the consuming callback", async () => {
  let now = 10_000;
  let calls = 0;
  const gate = createResetActionGate(
    async (): Promise<ResetConsumptionOutcome> => {
      calls += 1;
      return "reset";
    },
    () => now,
  );
  gate.setAvailableCount(1);
  const prepared = gate.prepare();
  if (prepared.outcome !== "ready") assert.fail("reset should be ready");

  now += 2 * 60_000;
  assert.equal(
    await gate.consume(prepared.confirmationToken),
    "confirmation-expired",
  );
  assert.equal(calls, 0);
});

test("reset preparation refuses zero or unknown availability", () => {
  let calls = 0;
  const gate = createResetActionGate(async (): Promise<ResetConsumptionOutcome> => {
    calls += 1;
    return "reset";
  });

  assert.equal(gate.prepare().outcome, "unavailable");
  gate.setAvailableCount(0);
  assert.equal(gate.prepare().outcome, "no-credit");
  assert.equal(calls, 0);
});

test("a second confirmation cannot spend again, even after a stale availability read", async () => {
  let now = 1_000;
  let calls = 0;
  const gate = createResetActionGate(
    async (): Promise<ResetConsumptionOutcome> => {
      calls += 1;
      return "reset";
    },
    () => now,
  );
  gate.setAvailableCount(1, now);
  const first = gate.prepare();
  const second = gate.prepare();
  if (first.outcome !== "ready" || second.outcome !== "ready") assert.fail("reset should be ready");

  const readStartedAtMs = now;
  now += 10;
  assert.equal(await gate.consume(first.confirmationToken), "reset");
  assert.equal(await gate.consume(second.confirmationToken), "confirmation-invalid");
  gate.setAvailableCount(1, readStartedAtMs);
  assert.equal(gate.prepare().outcome, "unavailable");
  assert.equal(calls, 1);
});
