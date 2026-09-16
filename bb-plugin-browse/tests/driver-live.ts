/** Explicit integration run: BROWSE_TEST_ROOT=/host/data npx tsx tests/driver-live.ts */
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { stat, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { launchManaged, managedEnv } from "../src/managed";
import { BrowserDriver } from "../src/driver";
import { Cdp } from "../src/cdp";
import { Recorder } from "../src/recorder";
import { CredentialBinding } from "../src/credentials";
import { capturePng } from "../src/capture";

const root = process.env.BROWSE_TEST_ROOT;
if (!root) throw Error("Set BROWSE_TEST_ROOT to a prepared Browse host data directory.");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/child") res.end("<button onclick=\"this.textContent='Child clicked'\">Child action</button>");
  else res.end(`<title>Fortress fixture</title><button id="plain" onclick="this.textContent='Clicked'">Main action</button><input id="email"><input id="password" type="password"><button id="submit" onclick="document.body.dataset.login='ok'">Sign in</button><div id="closed"></div><iframe id="child" src="http://localhost:${(server.address() as any).port}/child"></iframe><script>document.querySelector('#closed').attachShadow({mode:'closed'}).innerHTML='<button onclick="this.textContent=\\'Shadow clicked\\'">Shadow action</button>'</script>`);
});
server.listen(0, "0.0.0.0");
await once(server, "listening");
const signal = AbortSignal.timeout(90_000);
let browser: Awaited<ReturnType<typeof launchManaged>> | undefined;
let driver: BrowserDriver | undefined;
let cdp: Cdp | undefined;
try {
  browser = await launchManaged(root, `ab-fortress-validation-${Date.now()}`, signal);
  cdp = await Cdp.connect(browser.endpoint, true);
  driver = await BrowserDriver.connect(root, cdp, signal);
  await driver.execute(["open", `http://127.0.0.1:${(server.address() as any).port}/`], signal);
  const snapshot = JSON.parse(await driver.execute(["snapshot", "-i"], signal)).data.snapshot;
  const mainId = snapshot.match(/@(\S+).*Main action/)?.[1];
  assert.ok(mainId);
  await driver.execute(["click", `@${mainId}`], signal);
  assert.equal(JSON.parse(await driver.execute(["get", "text", "#plain"], signal)).data.text, "Clicked");
  const shadowId = JSON.parse(await driver.execute(["snapshot"], signal)).data.snapshot.match(/@(\S+).*Shadow action/)?.[1];
  assert.ok(shadowId);
  await driver.execute(["click", `@${shadowId}`], signal);
  assert.equal(JSON.parse(await driver.execute(["get", "text", `@${shadowId}`], signal)).data.text, "Shadow clicked");
  await driver.execute(["frame", "#child"], signal);
  const childSnapshot = JSON.parse(await driver.execute(["snapshot", "-i"], signal)).data.snapshot;
  const childId = childSnapshot.match(/@(\S+).*Child action/)?.[1];
  assert.ok(childId);
  await driver.execute(["click", `@${childId}`], signal);
  assert.equal(JSON.parse(await driver.execute(["get", "text", `@${childId}`], signal)).data.text, "Child clicked");
  await driver.execute(["frame", "main"], signal);
  await driver.execute(["fill", "#email", "dummy@example.test"], signal);
  assert.equal(JSON.parse(await driver.execute(["get", "value", "#email"], signal)).data.value, "dummy@example.test");
  const binding = await CredentialBinding.prepare(cdp, {
    id: "ab-fortress-validation",
    purpose: "Fixture login",
    fields: [
      { selector: "#email", kind: "username", label: "Email" },
      { selector: "#password", kind: "password", label: "Password" },
    ],
    submitSelector: "#submit",
  });
  await binding.fill(["dummy@example.test", "dummy-not-a-secret"]);
  await binding.dispose();
  assert.equal(JSON.parse(await driver.execute(["eval", "document.body.dataset.login"], signal)).data.result, "ok");
  assert.equal(JSON.parse(await driver.execute(["get", "value", "#password"], signal)).data.value, "");
  await driver.execute(["network", "route", "*/mock", "--body", "mocked"], signal);
  assert.equal(JSON.parse(await driver.execute(["eval", "fetch('/mock').then(r=>r.text())"], signal)).data.result, "mocked");
  await driver.execute(["network", "unroute"], signal);
  await cdp.startLiveCast();
  assert.ok((await cdp.nextLiveFrame()).data.length > 100);
  const recording = join(root, "fortress-validation.webm");
  const recorder = await Recorder.start(cdp, recording, 15, managedEnv(root));
  await new Promise((resolve) => setTimeout(resolve, 600));
  await recorder.stop();
  assert.ok((await stat(recording)).size > 100);
  await rm(recording);
  assert.ok(Buffer.from(await capturePng(cdp, false), "base64").byteLength > 100);
  console.log(JSON.stringify({ engine: "Fortress + deterministic CDP", passed: ["snapshot refs", "click", "fill", "closed shadow root", "cross-origin iframe refs", "live frames", "recording", "screenshot", "private credentials", "network mock"], modelCalls: 0 }));
} finally {
  await driver?.close();
  cdp?.close();
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
