// Opt-in validation against installed Chrome; isolated throwaway profile.
import { launchManaged } from "../src/managed";
import { Cdp } from "../src/cdp";
import { promises as fs } from "node:fs";
const root = process.argv[2];
if (!root) throw Error("Browse host-data path required");
const browser = await launchManaged(
  root,
  `ab-prefcheck-${Date.now()}`,
  AbortSignal.timeout(30000),
);
let cdp: Cdp | undefined;
try {
  const endpoint = new URL(browser.endpoint);
  const targets = (await (
    await fetch(`http://${endpoint.host}/json/list`)
  ).json()) as any[];
  cdp = await Cdp.connect(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await cdp.send("Page.navigate", { url: "chrome://prefs-internals/" });
  let prefs: any;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.body.innerText",
        returnByValue: true,
      });
      prefs = JSON.parse(r.result.value);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const keys = [
    "credentials_enable_service",
    "credentials_enable_autosignin",
    "autofill.profile_enabled",
    "autofill.credit_card_enabled",
    "password_manager.password_manager_blocklist",
  ];
  for (const key of keys) {
    const value = key.split(".").reduce((v, part) => v?.[part], prefs);
    console.log(key, JSON.stringify(value));
    const actual = value?.value ?? value;
    if (
      JSON.stringify(actual) !==
      JSON.stringify(key.endsWith("blocklist") ? ["*"] : false)
    )
      throw Error("Preference not applied: " + key);
  }
} finally {
  cdp?.close();
  await browser.close();
  await fs.rm(browser.profile, { recursive: true, force: true });
}
