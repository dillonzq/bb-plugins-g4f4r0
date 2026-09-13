import type { Job, Operation } from "./contracts";
/** One host round trip, ordered actions, bounded partial results, no mutation retries. */
export async function runSequence(
  steps: Exclude<Operation, { kind: "sequence" }>[],
  signal: AbortSignal,
  job: Job,
  run: (
    step: Exclude<Operation, { kind: "sequence" }>,
    child: Job,
  ) => Promise<void>,
) {
  const results: unknown[] = [];
  let size = 0;
  for (let index = 0; index < steps.length; index++) {
    signal.throwIfAborted();
    const step = steps[index],
      start = Date.now();
    const child: Job = {
      ...job,
      kind: step.kind,
      startedAt: start,
      artifacts: [],
      output: undefined,
      error: undefined,
    };
    try {
      await run(step, child);
      const result = {
        index,
        kind: step.kind,
        status: "succeeded",
        durationMs: Date.now() - start,
        output: child.output,
      };
      results.push(result);
      size += Buffer.byteLength(JSON.stringify(result));
      job.artifacts.push(...child.artifacts);
      job.output = JSON.stringify({
        completed: index + 1,
        total: steps.length,
        results,
      });
      if (size > 400000 && index + 1 < steps.length)
        throw new Error(
          "Sequence output budget reached; remaining steps were not executed. Use smaller sequences.",
        );
    } catch (error) {
      job.output = JSON.stringify({
        completed: results.length,
        total: steps.length,
        stoppedAt: index,
        results,
      });
      throw new Error(
        `Sequence stopped at step ${index + 1}/${steps.length} (${step.kind}). Prior steps may have changed the page; do not replay them. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
