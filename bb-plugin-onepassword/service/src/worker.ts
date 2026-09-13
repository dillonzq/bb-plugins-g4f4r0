import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright-core";
import { originSchema, type Delivery, type JobResult } from "./schema.js";
const selector = z.string().min(1).max(500);
const profileSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("environment"),
      executable: z.string().startsWith("/"),
      args: z.array(z.string()).max(100),
      cwd: z.string().startsWith("/"),
      uid: z.number().int().min(1),
      gid: z.number().int().min(1),
      baseEnv: z.record(z.string(), z.string()).default({}),
      returnOutput: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      executable: z.string().startsWith("/"),
      origins: z.array(originSchema).min(1),
      resourceOrigins: z.array(originSchema).default([]),
      username: selector,
      password: selector,
      submit: selector,
      totp: selector.optional(),
      totpSubmit: selector.optional(),
      success: selector,
      controls: z
        .record(
          z.string(),
          z
            .object({ selector, kind: z.enum(["click", "fill", "text"]) })
            .strict(),
        )
        .default({}),
    })
    .strict(),
]);
export const workerConfigSchema = z
  .object({
    origin: z.string().url(),
    tokenFile: z.string(),
    profiles: z.record(z.string(), profileSchema),
    allowLocalHttp: z.boolean().default(false),
  })
  .strict();
type WorkerConfig = z.infer<typeof workerConfigSchema>;
export function profileDigest(profile: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(profileSchema.parse(profile)))
    .digest("hex");
}
export function redact(value: string, secrets: Record<string, string>) {
  let output = value;
  for (const s of Object.values(secrets)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([
      s,
      encodeURIComponent(s),
      Buffer.from(s).toString("base64"),
    ]))
      output = output.split(variant).join("[redacted]");
  }
  return output;
}
export async function runCommand(
  job: Delivery,
  profile: Extract<z.infer<typeof profileSchema>, { kind: "environment" }>,
  signal: AbortSignal,
): Promise<JobResult> {
  const unsafe =
    /^(?:OP_|LD_|DYLD_|NODE_|PYTHON|BASH_ENV$|ENV$|PATH$|HOME$|SHELL$|IFS$)/;
  if (Object.keys(job.values).some((k) => unsafe.test(k)))
    return {
      ok: false,
      summary: "Mapping contains a reserved execution variable.",
      exitCode: null,
      output: "",
    };
  return new Promise((resolve) => {
    const child = spawn(profile.executable, profile.args, {
      cwd: profile.cwd,
      uid: profile.uid,
      gid: profile.gid,
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        ...profile.baseEnv,
        ...job.values,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = Buffer.alloc(0),
      finished = false;
    const collect = (chunk: Buffer) => {
      if (output.length < 32768)
        output = Buffer.concat([
          output,
          chunk.subarray(0, 32768 - output.length),
        ]);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const stop = () => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const timer = setTimeout(stop, Math.max(0, job.deadline - Date.now()));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      stop();
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve({
        ok: code === 0 && !signal.aborted && Date.now() < job.deadline,
        exitCode: code,
        summary:
          code === 0 ? "Command finished." : "Command stopped or failed.",
        output: profile.returnOutput
          ? redact(output.toString("utf8"), job.values)
          : "",
      });
      output.fill(0);
    };
    child.once("error", () => finish(null));
    child.once("close", finish);
  });
}
export type BrowserAction = {
  id: string;
  kind: "inspect" | "click" | "fill" | "navigate" | "close";
  control?: string;
  value?: string;
  url?: string;
};
export async function runBrowser(
  job: Delivery,
  profile: Extract<z.infer<typeof profileSchema>, { kind: "browser" }>,
  signal: AbortSignal,
  api: (path: string, body?: unknown) => Promise<any>,
): Promise<JobResult> {
  let browser: Browser | undefined;
  const allowed = (value: string, resources = false) => {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      ["https:", "http:"].includes(u.protocol) &&
      (resources
        ? [...profile.origins, ...profile.resourceOrigins]
        : profile.origins
      ).includes(u.origin) &&
      (resources || job.mapping.origins.includes(u.origin))
    );
  };
  try {
    if (!job.input.url || !allowed(job.input.url))
      throw Error("Destination rejected");
    browser = await chromium.launch({
      executablePath: profile.executable,
      headless: true,
      chromiumSandbox: true,
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
    });
    await context.route("**/*", (route) =>
      allowed(route.request().url(), !route.request().isNavigationRequest())
        ? route.continue()
        : route.abort(),
    );
    await context.routeWebSocket("**/*", (ws) => ws.close());
    const page = await context.newPage();
    context.on("page", (p) => {
      if (p !== page) void p.close();
    });
    page.on("dialog", (dialog) => void dialog.dismiss());
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(20000);
    const abort = () => {
      void context.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, Math.max(1, job.deadline - Date.now()));
    try {
      await page.goto(job.input.url);
      if (!allowed(page.url())) throw Error("Destination rejected");
      // No observation endpoint exists until this entire credential phase finishes.
      await page.locator(profile.username).fill(job.values.USERNAME);
      await page.locator(profile.password).fill(job.values.PASSWORD);
      await page.locator(profile.submit).click();
      if (profile.totp) {
        await page.locator(profile.totp).waitFor({ state: "visible" });
        const { code } = await api(
          "/worker/requests/" + job.requestId + "/totp",
          {},
        );
        if (typeof code !== "string" || !/^\d{6,10}$/.test(code))
          throw Error("TOTP unavailable");
        job.values.TOTP = code;
        await page.locator(profile.totp).fill(code);
        if (profile.totpSubmit) await page.locator(profile.totpSubmit).click();
      }
      await page.locator(profile.success).waitFor({ state: "visible" });
      if (!allowed(page.url())) throw Error("Destination rejected");
      // Remove any credential inputs before permitting observation.
      for (const sel of [
        profile.username,
        profile.password,
        profile.totp,
      ].filter(Boolean) as string[]) {
        const loc = page.locator(sel);
        if (await loc.count())
          await loc.evaluateAll((elements) => {
            for (const element of elements) {
              if (
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement
              )
                element.value = "";
            }
          });
      }
      await api("/worker/browser/" + job.requestId + "/ready", {
        controls: Object.entries(profile.controls).map(([id, c]) => ({
          id,
          kind: c.kind,
        })),
        url: new URL(page.url()).origin,
      });
      while (!signal.aborted && Date.now() < job.deadline) {
        const { action } = await api(
          "/worker/browser/" + job.requestId + "/next",
        );
        if (!action) {
          await delay(500, undefined, { signal }).catch(() => {});
          continue;
        }
        let result: { ok: boolean; text: string };
        try {
          const a = action as BrowserAction;
          if (a.kind === "close") {
            await api("/worker/browser/" + job.requestId + "/result", {
              id: a.id,
              ok: true,
              text: "Browser session closed.",
            });
            break;
          }
          if (a.kind === "navigate") {
            if (!a.url || !allowed(a.url)) throw Error("Destination rejected");
            await page.goto(a.url);
          } else if (a.kind === "inspect") {
          } else {
            const control = profile.controls[a.control ?? ""];
            if (!control || control.kind !== a.kind)
              throw Error("Control unavailable");
            const locator = page.locator(control.selector);
            if (a.kind === "click") await locator.click();
            else await locator.fill(a.value ?? "");
          }
          if (!allowed(page.url())) throw Error("Destination rejected");
          const texts: string[] = [];
          for (const [name, control] of Object.entries(profile.controls)) {
            if (control.kind === "text") {
              const loc = page.locator(control.selector);
              if (await loc.count())
                texts.push(
                  name + ": " + (await loc.first().innerText()).slice(0, 4000),
                );
            }
          }
          result = {
            ok: true,
            text: redact(texts.join("\n").slice(0, 16000), job.values),
          };
        } catch {
          result = {
            ok: false,
            text: "Browser action unavailable or destination rejected.",
          };
        }
        await api("/worker/browser/" + job.requestId + "/result", {
          id: action.id,
          ...result,
        });
      }
      return {
        ok: !signal.aborted,
        summary: signal.aborted
          ? "Browser session cancelled."
          : "Browser session closed.",
        exitCode: null,
        output: "",
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  } catch {
    return {
      ok: false,
      summary:
        "Browser login failed, expired, or was cancelled. The browser was closed.",
      exitCode: null,
      output: "",
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
export async function runWorker(config: WorkerConfig, signal: AbortSignal) {
  const u = new URL(config.origin);
  if (
    u.origin !== config.origin ||
    u.username ||
    u.password ||
    !(
      u.protocol === "https:" ||
      (config.allowLocalHttp &&
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname))
    )
  )
    throw Error("Worker requires an exact HTTPS origin.");
  const token = readFileSync(config.tokenFile, "utf8").trim();
  const api = async (path: string, body?: unknown) => {
    const r = await fetch(config.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error("Service request failed.");
    return r.json();
  };
  while (!signal.aborted) {
    try {
      const { job } = await api("/worker/claim", {});
      if (job) {
        const delivery = job as Delivery,
          profile = config.profiles[delivery.mapping.profile],
          controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        const poll = setInterval(() => {
          void api("/worker/requests/" + delivery.requestId).then(
            (r) => {
              if (r.status !== "running") controller.abort();
            },
            () => controller.abort(),
          );
        }, 1000);
        let result: JobResult = {
          ok: false,
          exitCode: null,
          summary:
            "Worker profile, digest, or execution identity does not match the approved configuration.",
          output: "",
        };
        try {
          if (
            Date.now() < delivery.deadline &&
            profile?.kind === delivery.mapping.kind &&
            profileDigest(profile) === delivery.mapping.profileDigest &&
            (profile.kind === "browser"
              ? process.getuid?.() !== 0
              : process.platform === "linux" && process.getuid?.() === 0)
          )
            result =
              profile.kind === "environment"
                ? await runCommand(delivery, profile, controller.signal)
                : await runBrowser(delivery, profile, controller.signal, api);
        } finally {
          clearInterval(poll);
          signal.removeEventListener("abort", abort);
          for (const key of Object.keys(delivery.values))
            delivery.values[key] = "";
        }
        await api("/worker/requests/" + delivery.requestId + "/result", result);
      }
    } catch {
      process.stderr.write(
        "Worker request failed; retrying without replaying an active job.\n",
      );
    }
    await delay(1000, undefined, { signal }).catch(() => {});
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = process.argv[2];
  if (!file) throw Error("Usage: node dist/worker.js /path/to/worker.json");
  const config = workerConfigSchema.parse(
      JSON.parse(readFileSync(file, "utf8")),
    ),
    stop = new AbortController();
  process.on("SIGTERM", () => stop.abort());
  process.on("SIGINT", () => stop.abort());
  await runWorker(config, stop.signal);
}
