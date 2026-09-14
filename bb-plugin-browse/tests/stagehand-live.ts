/** Explicit integration run: BROWSE_TEST_ROOT=/host/data npx tsx tests/stagehand-live.ts */
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { stat, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { launchManaged, managedEnv } from "../src/managed";
import { StagehandDriver } from "../src/stagehand";
import { Cdp } from "../src/cdp";
import { Recorder } from "../src/recorder";
import { CredentialBinding } from "../src/credentials";
const root = process.env.BROWSE_TEST_ROOT;
if (!root)
  throw Error("Set BROWSE_TEST_ROOT to a prepared Browse host data directory.");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/child")
    res.end(
      "<button onclick=\"this.textContent='Child clicked'\">Child action</button>",
    );
  else
    res.end(
      `<title>Stagehand fixture</title><button id="plain" onclick="this.textContent='Clicked'">Main action</button><input id="email"><input id="password" type="password"><button id="submit" onclick="document.body.dataset.login='ok'">Sign in</button><div id="closed"></div><iframe src="http://localhost:${(server.address() as any).port}/child"></iframe><script>document.querySelector('#closed').attachShadow({mode:'closed'}).innerHTML='<button onclick="this.textContent=\\'Shadow clicked\\'">Shadow action</button>'</script>`,
    );
});
server.listen(0, "0.0.0.0");
await once(server, "listening");
const signal = AbortSignal.timeout(90000);
let browser: Awaited<ReturnType<typeof launchManaged>> | undefined,
  driver: StagehandDriver | undefined,
  cdp: Cdp | undefined;
try {
  browser = await launchManaged(root, "ab-stagehand-validation", signal);
  cdp = await Cdp.connect(browser.endpoint, true);
  driver = await StagehandDriver.connect(root, browser.endpoint, cdp, signal);
  await driver.execute(
    ["open", `http://127.0.0.1:${(server.address() as any).port}/`],
    signal,
  );
  const snap = JSON.parse(await driver.execute(["snapshot", "-i"], signal)).data
    .snapshot;
  const id = snap.match(/\[([^\]]+)\].*Main action/)?.[1];
  assert.ok(id);
  await driver.execute(["click", `@${id}`], signal);
  assert.equal(await driver.page.locator("#plain").innerText(), "Clicked");
  const shadowTree = JSON.parse(await driver.execute(["snapshot"], signal)).data
    .snapshot;
  const shadowId = shadowTree.match(/\[([^\]]+)\].*Shadow action/)?.[1];
  assert.ok(shadowId);
  await driver.element("click", `@${shadowId}`);
  assert.equal(
    await driver.page.locator(driver.selector(`@${shadowId}`)).innerText(),
    "Shadow clicked",
  );
  await driver.element("click", "iframe >> button");
  assert.equal(
    await driver.page.locator("iframe >> button").innerText(),
    "Child clicked",
  );
  await driver.element("fill", "#email", "dummy@example.test");
  assert.equal(
    await driver.page.locator("#email").inputValue(),
    "dummy@example.test",
  );
  const binding = await CredentialBinding.prepare(cdp, {
    id: "ab-stagehand-validation",
    purpose: "Fixture login",
    fields: [
      { selector: "#email", kind: "username", label: "Email" },
      { selector: "#password", kind: "password", label: "Password" },
    ],
    submitSelector: "#submit",
  });
  await binding.fill(["dummy@example.test", "dummy-not-a-secret"]);
  await binding.dispose();
  assert.equal(await driver.page.evaluate("document.body.dataset.login"), "ok");
  assert.equal(await driver.page.locator("#password").inputValue(), "");
  await driver.execute(
    ["network", "route", "*/mock", "--body", "mocked"],
    signal,
  );
  assert.equal(
    await driver.page.evaluate("fetch('/mock').then(r=>r.text())"),
    "mocked",
  );
  await driver.execute(["network", "unroute"], signal);
  await cdp.startLiveCast();
  const frame = await cdp.nextLiveFrame();
  assert.ok(frame.data.length > 100);
  const path = join(root, "stagehand-validation.webm");
  const recorder = await Recorder.start(cdp, path, 15, managedEnv(root));
  await new Promise((r) => setTimeout(r, 600));
  await recorder.stop();
  assert.ok((await stat(path)).size > 100);
  await rm(path);
  assert.ok((await driver.page.screenshot()).byteLength > 100);
  console.log(
    JSON.stringify({
      engine: "Stagehand 4.1.0",
      passed: [
        "exact tab binding",
        "snapshot refs",
        "click",
        "fill",
        "closed shadow root",
        "cross-origin iframe",
        "live frames",
        "recording",
        "screenshot",
        "private credential binding",
        "network mock",
      ],
      modelCalls: 0,
    }),
  );
} finally {
  await driver?.close();
  cdp?.close();
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
}
