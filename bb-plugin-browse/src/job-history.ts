import type { Job } from "./contracts";
/** Bound retained completed results by both count and UTF-8 payload bytes. Active jobs are never evicted. */
export function pruneJobHistory<T extends { view: Job; bytes?: number }>(
  jobs: Map<string, T>,
  keepId?: string,
  maxBytes = 8 * 1024 * 1024,
  maxCount = 200,
) {
  let bytes = 0;
  for (const t of jobs.values())
    if (t.view.status !== "running") {
      t.bytes ??= Buffer.byteLength(JSON.stringify(t.view));
      bytes += t.bytes;
    }
  for (const [id, t] of jobs) {
    if (jobs.size <= maxCount && bytes <= maxBytes) break;
    if (id === keepId || t.view.status === "running") continue;
    jobs.delete(id);
    bytes -= t.bytes ?? 0;
  }
}
