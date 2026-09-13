import { it, expect } from "vitest";
import { pruneJobHistory } from "../src/job-history";
import type { Job } from "../src/contracts";
function job(id: string, status: Job["status"], output = ""): Job {
  return {
    id,
    kind: "test",
    status,
    startedAt: 1,
    durationMs: 0,
    artifacts: [],
    output,
  };
}
it("evicts older completed payloads by bytes while retaining active and latest jobs", () => {
  const jobs = new Map([
    ["old", { view: job("old", "succeeded", "x".repeat(700)) }],
    ["running", { view: job("running", "running") }],
    ["last", { view: job("last", "succeeded", "x".repeat(700)) }],
  ]);
  pruneJobHistory(jobs, "last", 1100);
  expect([...jobs.keys()]).toEqual(["running", "last"]);
});
it("enforces count limits without deleting running jobs", () => {
  const jobs = new Map(
    Array.from({ length: 240 }, (_, i) => [
      String(i),
      { view: job(String(i), i === 0 ? "running" : "succeeded") },
    ]),
  );
  pruneJobHistory(jobs, "239");
  expect(jobs.size).toBe(200);
  expect(jobs.has("0")).toBe(true);
  expect(jobs.has("239")).toBe(true);
  expect(jobs.has("1")).toBe(false);
});
