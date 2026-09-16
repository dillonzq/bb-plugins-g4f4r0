/**
 * Opt-in live regression for MiniWoB widget patterns that failed model trials.
 * This measures browser primitives, not model quality.
 * BROWSE_TEST_ROOT=/host/data npx tsx tests/agent-capability-live.mts
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserDriver } from "../src/driver";
import { Cdp } from "../src/cdp";
import { launchManaged } from "../src/managed";

const root = process.env.BROWSE_TEST_ROOT;
if (!root)
  throw Error(
    "Set BROWSE_TEST_ROOT to the prepared Browse host data directory.",
  );
const port = 39116;
const base = `http://127.0.0.1:${port}/miniwob`;
const trials = Number(process.env.BROWSE_BENCH_TRIALS ?? 5);
const output = process.env.BROWSE_BENCH_OUTPUT;
let site: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof launchManaged>> | undefined;
let cdp: Cdp | undefined;
let driver: BrowserDriver | undefined;
const profileId = `ab-capability-${Date.now()}`;

function json(raw: string) {
  return JSON.parse(raw).data;
}
async function startSite() {
  site = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/miniwob-site.mts", `--port=${port}`],
    {
      cwd: join(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  site.stderr?.on("data", (chunk) => (stderr += chunk));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`MiniWoB server timed out: ${stderr}`)),
      15000,
    );
    site!.once("exit", (code) =>
      reject(new Error(`MiniWoB server exited ${code}: ${stderr}`)),
    );
    site!.stdout?.on("data", (chunk) => {
      if (String(chunk).includes('"ready":true')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}
async function run(args: string[]) {
  const began = performance.now();
  const result = json(await driver!.execute(args, AbortSignal.timeout(15000)));
  return { result, ms: performance.now() - began };
}
async function removeProfile(path: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2 });
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw last;
}
async function options() {
  const deadline = Date.now() + 5000;
  for (;;) {
    const values = (
      await run([
        "eval",
        `[...document.querySelectorAll('.ui-autocomplete li')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height}).map(e=>(e.innerText||e.textContent||'').trim())`,
      ])
    ).result.result as string[];
    if (values.length || Date.now() >= deadline) return values;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
async function startTask(task: string, seed: string) {
  await run(["open", `${base}/${task}.html`]);
  await run([
    "eval",
    `Math.seedrandom(${JSON.stringify(seed)});core.EPISODE_MAX_TIME=60000;core.startEpisodeReal()`,
  ]);
  return String((await run(["get", "text", "#query"])).result.text)
    .replace(/\s+/g, " ")
    .trim();
}
async function finish() {
  return (
    await run([
      "eval",
      `({done:WOB_DONE_GLOBAL,reward:WOB_RAW_REWARD_GLOBAL,reason:WOB_REWARD_REASON})`,
    ])
  ).result.result;
}
async function autocomplete() {
  const instruction = await run(["get", "text", "#query"]);
  const starts =
    String(instruction.result.text).match(/starts with "([^"]+)"/)?.[1] ?? "";
  const ends = String(instruction.result.text).match(
    /ends with "([^"]+)"/,
  )?.[1];
  await run(["fill", "#tags", starts]);
  const matches = await options();
  const choice = matches.find((value) => !ends || value.endsWith(ends));
  assert.ok(choice, `No autocomplete choice matched ${starts}/${ends}`);
  await run(["choose", "#tags", starts, choice]);
  await run(["click", "#subbtn"]);
}
async function tabs(instruction: string) {
  const target = instruction.match(/link "([^"]+)"/)?.[1];
  assert.ok(target);
  const inspected: string[] = [];
  for (let tab = 1; tab <= 3; tab++) {
    await run(["click", `a[href="#tabs-${tab}"]`]);
    const snapshot = String((await run(["snapshot", "-i"])).result.snapshot);
    inspected.push(snapshot);
    const line = snapshot
      .split("\n")
      .find((value) => value.includes(`: ${JSON.stringify(target)}`));
    if (!line) continue;
    const ref = line.match(/^@(\S+) /)?.[1];
    if (ref) {
      await run(["click", `@${ref}`]);
      return;
    }
    const encoded = line.match(/^selector ("(?:[^"\\]|\\.)*") /)?.[1];
    assert.ok(encoded, `Custom link lacked a DOM selector: ${line}`);
    await run(["click", JSON.parse(encoded)]);
    return;
  }
  assert.fail(`Link ${target} was not exposed in any visible tab. Snapshots: ${inspected.join("\n---\n")}`);
}
async function chooseAirport(field: string, query: string) {
  await run(["fill", field, query]);
  const choices = await options();
  assert.ok(choices[0], `No airport suggestion for ${query}`);
  await run(["choose", field, query, choices[0]]);
}
async function flight(instruction: string) {
  const match = instruction.match(
    /Book the (cheapest|shortest).*from: (.+?) to: (.+?) on (\d{1,2}\/\d{1,2}\/\d{4})\./,
  );
  assert.ok(match, instruction);
  await chooseAirport("#flight-from", match[2]);
  await chooseAirport("#flight-to", match[3]);
  const [month, day, year] = match[4].split("/");
  await run([
    "date",
    "#datepicker",
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  ]);
  await run(["click", "#search"]);
  const index = Number(
    (
      await run([
        "eval",
        `(()=>{const flights=[...document.querySelectorAll('.flight')];const values=flights.map((e,i)=>({i,price:Number(e.querySelector('.flight-price').dataset.price),duration:Number(e.querySelector('.time-duration').dataset.duration)}));return values.reduce((a,b)=>b.${match[1] === "cheapest" ? "price" : "duration"}<a.${match[1] === "cheapest" ? "price" : "duration"}?b:a).i})()`,
      ])
    ).result.result,
  );
  await run(["click", `#results > .flight:nth-of-type(${index + 2}) .flight-price`]);
}
async function dragItems(instruction: string) {
  const match = instruction.match(/^Drag (.+?) (to the top|to the bottom|down by one position|up by one position|to the \d+(?:st|nd|rd|th) position)\.$/);
  assert.ok(match, instruction);
  const items = (await run(["eval", `[...document.querySelectorAll('#sortable > li')].map(e=>(e.innerText||e.textContent||'').trim())`])).result.result as string[];
  const source = items.indexOf(match[1]);
  assert.ok(source >= 0, `Drag source ${match[1]} was not found`);
  const destination = match[2] === "to the top" ? 0 : match[2] === "to the bottom" ? items.length - 1 : match[2] === "down by one position" ? source + 1 : match[2] === "up by one position" ? source - 1 : Number(match[2].match(/\d+/)?.[0]) - 1;
  assert.ok(destination >= 0 && destination < items.length && destination !== source);
  await run(["drag", `#sortable > li:nth-of-type(${source + 1})`, `#sortable > li:nth-of-type(${destination + 1})`]);
}

const records: Array<Record<string, unknown>> = [];
try {
  await startSite();
  const signal = AbortSignal.timeout(180000);
  browser = await launchManaged(root, profileId, signal);
  cdp = await Cdp.connect(browser.endpoint, true);
  driver = await BrowserDriver.connect(root, cdp, signal);
  for (const task of [
    "use-autocomplete",
    "click-tab-2",
    "book-flight",
    "drag-items",
  ] as const) {
    for (let trial = 0; trial < trials; trial++) {
      const began = performance.now();
      const instruction = await startTask(task, `browse-${task}-${trial}`);
      if (task === "use-autocomplete") await autocomplete();
      else if (task === "click-tab-2") await tabs(instruction);
      else if (task === "book-flight") await flight(instruction);
      else await dragItems(instruction);
      const score = await finish();
      records.push({
        task,
        trial,
        durationMs: Math.round(performance.now() - began),
        ...score,
      });
      assert.equal(score.done, true, `${task}/${trial} did not finish`);
      assert.ok(score.reward > 0, `${task}/${trial} failed: ${score.reason}`);
    }
  }
  const durations = records
    .map((value) => Number(value.durationMs))
    .sort((a, b) => a - b);
  const report = {
    engine: "Fortress + deterministic CDP",
    scope: "browser primitive regression; no model calls",
    trials: records.length,
    passed: records.filter((value) => Number(value.reward) > 0).length,
    medianMs: durations[Math.floor(durations.length / 2)],
    p95Ms:
      durations[
        Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)
      ],
    records,
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await driver?.close();
  cdp?.close();
  await browser?.close();
  await removeProfile(join(root, "profiles", profileId));
  if (site && site.exitCode === null) {
    site.kill("SIGTERM");
    await Promise.race([
      once(site, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (site.exitCode === null) site.kill("SIGKILL");
  }
}
