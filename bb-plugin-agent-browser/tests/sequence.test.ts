import { it, expect, vi } from "vitest";
import { runSequence } from "../src/sequence";
import { operation, type Job } from "../src/contracts";
function job(): Job {
  return {
    id: "job",
    kind: "sequence",
    status: "running",
    startedAt: Date.now(),
    durationMs: 0,
    artifacts: [],
  };
}
const steps = [0, 1, 2].map(() => ({
  kind: "command" as const,
  args: ["get", "title"],
}));
it("retains partial results and never runs steps after a failure", async () => {
  const j = job();
  let mutations = 0;
  const run = vi.fn(async (_step, child) => {
    mutations++;
    if (mutations === 2) throw new Error("failed");
    child.output = "first result";
    child.artifacts = [
      { id: "one", name: "one", path: "/one", mime: "text/plain", bytes: 1 },
    ];
  });
  await expect(
    runSequence(steps, new AbortController().signal, j, run),
  ).rejects.toThrow("do not replay");
  expect(mutations).toBe(2);
  expect(JSON.parse(j.output!)).toMatchObject({ completed: 1, stoppedAt: 1 });
  expect(j.artifacts).toHaveLength(1);
});
it("cancels between steps and leaves completed actions recorded", async () => {
  const j = job(),
    c = new AbortController();
  const run = vi.fn(async () => {
    c.abort();
  });
  await expect(runSequence(steps, c.signal, j, run)).rejects.toThrow();
  expect(run).toHaveBeenCalledOnce();
  expect(JSON.parse(j.output!).completed).toBe(1);
});
it("rejects nested sequences and defaults bounded element waiting", () => {
  expect(
    operation.safeParse({
      kind: "sequence",
      steps: [{ kind: "sequence", steps }],
    }).success,
  ).toBe(false);
  expect(
    operation.parse({ kind: "element", action: "click", selector: "#button" }),
  ).toMatchObject({ waitMs: 3000 });
});
