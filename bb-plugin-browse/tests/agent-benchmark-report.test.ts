import { expect, it } from "vitest";
import { aggregateAgentReports } from "../scripts/agent-benchmark-report";

const protocol = {
  viewport: { width: 1280, height: 800 },
  episodeTimeoutMs: 60000,
  trialCount: 1,
};
const report = (model: string, success = true) => ({
  model,
  seed: "seed-1",
  protocol,
  tasks: [
    { id: "one", success, elapsedMs: 100, actionCount: 2 },
    { id: "two", success: true, elapsedMs: 300, actionCount: 1 },
  ],
});

it("recomputes comparable benchmark summaries", () => {
  const result = aggregateAgentReports([
    report("first"),
    report("second", false),
  ] as any);
  expect(result.protocol).toMatchObject({
    seed: "seed-1",
    viewport: "1280x800",
    timeoutMs: 60000,
    trialsPerTask: 1,
  });
  expect(result.results[0]).toMatchObject({
    successes: 2,
    total: 2,
    successRate: 1,
    medianMs: 200,
    p95Ms: 300,
    actions: 3,
  });
  expect(result.results[1].failedTasks).toEqual(["one"]);
});

it("rejects reports with different seeds or task order", () => {
  const otherSeed = { ...report("second"), seed: "seed-2" };
  expect(() =>
    aggregateAgentReports([report("first"), otherSeed] as any),
  ).toThrow("Protocol mismatch");
  const otherOrder = {
    ...report("second"),
    tasks: [...report("second").tasks].reverse(),
  };
  expect(() =>
    aggregateAgentReports([report("first"), otherOrder] as any),
  ).toThrow("Protocol mismatch");
});
