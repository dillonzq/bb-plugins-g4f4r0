import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

type Task = {
  id: string;
  success: boolean;
  elapsedMs: number;
  actionCount?: number;
  retries?: number;
  browserErrors?: number;
};
type Report = {
  engine?: string;
  automation?: string;
  model: string;
  seed: string;
  protocol: Record<string, any>;
  tasks: Task[];
};

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[rank];
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizedProtocol(report: Report) {
  const viewport = report.protocol.viewport ?? {};
  return {
    seed: report.seed,
    viewport: `${viewport.width}x${viewport.height}`,
    timeoutMs: report.protocol.episodeTimeoutMs,
    taskIds: report.tasks.map((task) => task.id),
    trialsPerTask:
      report.protocol.trialCount ??
      report.protocol.trials ??
      (new Set(report.tasks.map((task) => task.id)).size === report.tasks.length
        ? 1
        : undefined),
  };
}

export function aggregateAgentReports(reports: Report[]) {
  if (reports.length < 2)
    throw new Error("Pass at least two benchmark reports.");
  const expected = normalizedProtocol(reports[0]);
  for (const report of reports) {
    const actual = normalizedProtocol(report);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `Protocol mismatch for ${report.model}: ${JSON.stringify(actual)} does not match ${JSON.stringify(expected)}`,
      );
    for (const task of report.tasks) {
      if (!Number.isFinite(task.elapsedMs) || task.elapsedMs < 0)
        throw new Error(`${report.model}/${task.id} has invalid elapsedMs.`);
      if (typeof task.success !== "boolean")
        throw new Error(`${report.model}/${task.id} has invalid success.`);
    }
  }
  return {
    protocol: expected,
    results: reports.map((report) => {
      const durations = report.tasks.map((task) => task.elapsedMs);
      const successes = report.tasks.filter((task) => task.success).length;
      return {
        label: [report.engine, report.automation, report.model]
          .filter(Boolean)
          .join(" · "),
        model: report.model,
        successes,
        total: report.tasks.length,
        successRate: successes / report.tasks.length,
        medianMs: median(durations),
        p95Ms: percentile(durations, 0.95),
        actions: report.tasks.reduce(
          (sum, task) => sum + Number(task.actionCount ?? 0),
          0,
        ),
        retries: report.tasks.reduce(
          (sum, task) => sum + Number(task.retries ?? 0),
          0,
        ),
        browserErrors: report.tasks.reduce(
          (sum, task) => sum + Number(task.browserErrors ?? 0),
          0,
        ),
        failedTasks: report.tasks
          .filter((task) => !task.success)
          .map((task) => task.id),
      };
    }),
  };
}

async function main() {
  const paths = process.argv.slice(2);
  const reports = await Promise.all(
    paths.map(
      async (path) => JSON.parse(await readFile(path, "utf8")) as Report,
    ),
  );
  process.stdout.write(
    `${JSON.stringify(aggregateAgentReports(reports), null, 2)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
