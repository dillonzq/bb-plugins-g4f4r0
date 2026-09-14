import { setTimeout as sleep } from "node:timers/promises";
import type { Page, StagehandBrowser } from "@browserbasehq/stagehand";
import { stagehandSdk, runtimePath } from "./runtime";
import { actOnElement } from "./element";
import type { Cdp } from "./cdp";
import { safeUrl } from "./policy";
import { promises as fs } from "node:fs";
import { join } from "node:path";

/** One persistent SDK connection, always bound to the session's exact page. */
export class StagehandDriver {
  private frame = "";
  private refs: Record<string, string> = {};
  private urls: Record<string, string> = {};
  private logs: unknown[] = [];
  private requests: unknown[] = [];
  private routes = new Map<string, { body?: string; block: boolean }>();
  private disposeLog?: () => void;
  private constructor(
    readonly browser: StagehandBrowser,
    readonly page: Page,
    readonly cdp: Cdp,
    readonly root: string,
  ) {}
  static async connect(
    root: string,
    endpoint: string,
    cdp: Cdp,
    signal: AbortSignal,
  ) {
    const sdk = await stagehandSdk(root, signal);
    const browser = await sdk.localBrowser.connect({ cdpUrl: endpoint });
    try {
      await sdk.Stagehand.create({ browser, logging: { level: "off" } });
      signal.throwIfAborted();
      // Stagehand's Page.pageId is Chromium's target id (pinned SDK 4.1.0).
      const selected = (await browser.context.pages()).find(
        (page) => page.pageId === cdp.targetId,
      );
      if (!selected)
        throw new Error("Stagehand could not bind the selected browser tab.");
      const driver = new StagehandDriver(browser, selected, cdp, root);
      await cdp.send("Page.enable");
      await cdp.send("Network.enable");
      await cdp.send("Runtime.enable");
      driver.disposeLog = cdp.onEvent((method, params) => {
        if (method === "Network.requestWillBeSent") {
          driver.requests.push({
            id: params.requestId,
            url: params.request.url,
            method: params.request.method,
          });
          driver.requests = driver.requests.slice(-200);
        }
        if (method === "Fetch.requestPaused") {
          const match = [...driver.routes].find(([pattern]) =>
            new RegExp(
              "^" +
                pattern
                  .split("*")
                  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                  .join(".*") +
                "$",
            ).test(params.request.url),
          );
          const rule = match?.[1];
          void cdp
            .send(
              rule?.block
                ? "Fetch.failRequest"
                : rule?.body !== undefined
                  ? "Fetch.fulfillRequest"
                  : "Fetch.continueRequest",
              rule?.block
                ? {
                    requestId: params.requestId,
                    errorReason: "BlockedByClient",
                  }
                : rule?.body !== undefined
                  ? {
                      requestId: params.requestId,
                      responseCode: 200,
                      body: Buffer.from(rule.body).toString("base64"),
                    }
                  : { requestId: params.requestId },
            )
            .catch(() => {});
        }
        if (method === "Page.frameNavigated" && !params.frame?.parentId) {
          driver.refs = {}; driver.urls = {};
          driver.frame = "";
        }
        if (
          method === "Runtime.consoleAPICalled" ||
          method === "Runtime.exceptionThrown"
        ) {
          driver.logs.push({ method, params });
          driver.logs = driver.logs.slice(-100);
        }
      });
      return driver;
    } catch (e) {
      await browser.close().catch(() => {});
      throw e;
    }
  }
  async close() {
    this.disposeLog?.();
    await this.browser.close();
  }
  selector(value: string) {
    if (/^@/.test(value)) {
      const found = this.refs[value.slice(1)];
      if (!found)
        throw new Error("Unknown or stale reference. Take a fresh snapshot.");
      return found;
    }
    return this.frame
      ? `${this.frame} >> ${value}`
      : value.replaceAll(" >>> ", " ");
  }
  async element(
    action: "click" | "hover" | "fill",
    selector: string,
    value?: string,
    waitMs = 3000,
    signal = new AbortController().signal,
  ) {
    if (action === "fill" && value === undefined)
      throw Error("Fill needs a value.");
    if (selector.includes(" >>> "))
      return actOnElement(
        this.cdp,
        { kind: "element", action, selector, value, waitMs },
        signal,
      );
    const resolved = this.selector(selector);
    const loc = this.page.locator(resolved);
    const until = Date.now() + waitMs;
    for (;;) {
      signal.throwIfAborted();
      const count = await loc.count();
      if (count > 1)
        throw new Error("Selector must identify exactly one element.");
      if (count === 1 && (await loc.isVisible())) break;
      if (Date.now() >= until)
        throw new Error("Element is missing or not visible.");
      await sleep(50, undefined, { signal });
    }
    signal.throwIfAborted();
    if (action === "fill") await loc.fill(value ?? "");
    else if (action === "hover") await loc.hover();
    else await loc.click();
    return JSON.stringify({ success: true, data: { action, selector } });
  }
  async execute(args: string[], signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const [cmd, ...a] = args;
    const p = this.page;
    const sel = () => this.selector(a[0] ?? "");
    const loc = () => p.locator(sel());
    let data: unknown = {};
    switch (cmd) {
      case "open":
        this.refs = {}; this.urls = {};
        this.frame = "";
        await p.goto(safeUrl(a[0]));
        data = { url: await p.url() };
        break;
      case "reload":
        this.refs = {}; this.urls = {};
        await p.reload();
        break;
      case "back":
        this.refs = {}; this.urls = {};
        await p.goBack();
        break;
      case "forward":
        this.refs = {}; this.urls = {};
        await p.goForward();
        break;
      case "snapshot": {
        const snapshot = await p.snapshot({ includeIframes: true });
        // The SDK's own locator mappings are retained, never reconstructed from labels.
        this.refs = snapshot.xpathMap;
        this.urls = snapshot.urlMap;
        const tree = a.includes("-i")
          ? snapshot.formattedTree
              .split("\n")
              .filter((line) =>
                /button|link|textbox|combobox|checkbox|radio|slider|spinbutton|menuitem|tab:|searchbox|switch/i.test(
                  line,
                ),
              )
              .join("\n")
          : snapshot.formattedTree;
        data = {
          snapshot: tree,
          referenceSyntax: "Use @<id>, for example @0-19, from this snapshot.",
        };
        break;
      }
      case "eval":
        data = { result: await p.evaluate(a.join(" ")) };
        break;
      case "click":
        await loc().click();
        break;
      case "dblclick":
        await loc().click({ clickCount: 2 });
        break;
      case "hover":
        await loc().hover();
        break;
      case "fill":
        await loc().fill(a[1] ?? "");
        break;
      case "type":
        if (a.length > 1) await loc().type(a[1]);
        else await p.type(a[0]);
        break;
      case "press":
        await p.keyPress(a.join(" "));
        break;
      case "keyboard":
        if (a[0] === "type") await p.type(a.slice(1).join(" "));
        else await p.keyPress(a.slice(1).join(" "));
        break;
      case "select":
        data = { values: await loc().selectOption(a.slice(1)) };
        break;
      case "check":
      case "uncheck":
        if ((await loc().isChecked()) !== (cmd === "check"))
          await loc().click();
        break;
      case "upload":
        await loc().setInputFiles(a.slice(1));
        break;
      case "scroll": {
        const amount = Number(a[1] ?? 500);
        if (!Number.isFinite(amount)) throw Error("Invalid scroll distance");
        const left = a[0] === "left",
          right = a[0] === "right";
        await p.scroll(
          300,
          300,
          left ? -amount : right ? amount : 0,
          a[0] === "up" ? -amount : left || right ? 0 : amount,
        );
        break;
      }
      case "scrollintoview":
        await loc().scrollTo(50);
        break;
      case "drag": {
        const from = await loc().centroid(),
          to = await p.locator(this.selector(a[1])).centroid();
        await p.dragAndDrop(from.x, from.y, to.x, to.y);
        break;
      }
      case "wait":
        if (/^\d+$/.test(a[0]))
          await p.waitForTimeout(Math.min(Number(a[0]), 30000));
        else await p.waitForSelector(sel(), { timeout: 25000 });
        break;
      case "frame":
        this.frame = a[0] === "main" ? "" : this.selector(a[0]);
        this.refs = {}; this.urls = {};
        break;
      case "get": {
        const [what, target, attribute] = a;
        if (what === "title") data = { title: await p.title() };
        else if (what === "url") data = { url: await p.url() };
        else if (what === "text")
          data = { text: await p.locator(this.selector(target)).innerText() };
        else if (what === "html")
          data = { html: await p.locator(this.selector(target)).innerHtml() };
        else if (what === "value")
          data = { value: await p.locator(this.selector(target)).inputValue() };
        else if (what === "count")
          data = { count: await p.locator(this.selector(target)).count() };
        else if (what === "box")
          data = await this.dom(
            target,
            "(()=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()",
          );
        else if (what === "attr")
          data = {
            value:
              attribute === "href" && this.urls[target?.replace(/^@/, "")]
                ? this.urls[target.replace(/^@/, "")]
                : await this.dom(
                    target,
                    `el.getAttribute(${JSON.stringify(attribute)})`,
                  ),
          };
        else throw Error(`Unsupported get operation: ${what}`);
        break;
      }
      case "is":
        data = {
          value:
            a[0] === "checked"
              ? await p.locator(this.selector(a[1])).isChecked()
              : a[0] === "visible"
                ? await p.locator(this.selector(a[1])).isVisible()
                : await this.dom(a[1], "!el.disabled"),
        };
        break;
      case "focus":
        await this.dom(a[0], "el.focus()");
        break;
      case "storage": {
        const storage = a[0] === "session" ? "sessionStorage" : "localStorage";
        if (a[1] === "set")
          await p.evaluate(
            `${storage}.setItem(${JSON.stringify(a[2])},${JSON.stringify(a[3])})`,
          );
        else if (a[1] === "clear") await p.evaluate(`${storage}.clear()`);
        else
          data = {
            value: await p.evaluate(
              a[2]
                ? `${storage}.getItem(${JSON.stringify(a[2])})`
                : `Object.fromEntries(Object.entries(${storage}))`,
            ),
          };
        break;
      }
      case "cookies": {
        if (a[0] === "clear") await this.browser.context.clearCookies();
        else if (a[0] === "set")
          await this.browser.context.addCookies([
            { name: a[1], value: a[2], url: await p.url() },
          ]);
        else
          data = { cookies: await this.browser.context.cookies(await p.url()) };
        break;
      }
      case "network": {
        if (a[0] === "requests") data = this.requests;
        else if (a[0] === "route") {
          if (!a[1]) throw Error("A URL pattern is required");
          const bodyIndex = a.indexOf("--body");
          this.routes.set(a[1], {
            block: a.includes("--abort"),
            ...(bodyIndex < 0 ? {} : { body: a[bodyIndex + 1] ?? "" }),
          });
          await this.cdp.send("Fetch.enable", {
            patterns: [...this.routes.keys()].map((urlPattern) => ({
              urlPattern,
            })),
          });
        } else if (a[0] === "unroute") {
          if (a[1]) this.routes.delete(a[1]);
          else this.routes.clear();
          if (this.routes.size)
            await this.cdp.send("Fetch.enable", {
              patterns: [...this.routes.keys()].map((urlPattern) => ({
                urlPattern,
              })),
            });
          else await this.cdp.send("Fetch.disable");
        } else
          throw Error(
            "Use network requests, route <pattern> [--abort|--body text], or unroute [pattern]",
          );
        break;
      }
      case "dialog":
        await this.cdp.send("Page.handleJavaScriptDialog", {
          accept: a[0] === "accept",
          promptText: a[1] ?? "",
        });
        break;
      case "console":
      case "errors":
        data = this.logs.filter(
          (v: any) =>
            cmd === "console" || v.method === "Runtime.exceptionThrown",
        );
        if (a[0] === "--clear") this.logs = [];
        break;
      case "set":
        if (a[0] === "viewport")
          await p.setViewportSize(Number(a[1]), Number(a[2]));
        else if (a[0] === "headers")
          await p.setExtraHTTPHeaders(JSON.parse(a.slice(1).join(" ")));
        else throw Error(`Unsupported set operation: ${a[0]}`);
        break;
      case "a11y": {
        const source = await fs.readFile(
          join(runtimePath(this.root), "node_modules/axe-core/axe.min.js"),
          "utf8",
        );
        data = await p.evaluate(
          `${source};axe.run().then(r=>({violations:r.violations,incomplete:r.incomplete}))`,
        );
        break;
      }
      default:
        throw new Error(
          `Unsupported Stagehand command: ${cmd}. Use Browse structured actions or eval.`,
        );
    }
    signal?.throwIfAborted();
    return JSON.stringify({ success: true, data: data ?? null, error: null });
  }
  private async dom(selector: string, expression: string) {
    // Explicit limitation: SDK currently has no Locator.evaluate/getAttribute.
    const resolved = this.selector(selector);
    if (resolved.includes(" >> "))
      throw Error(
        "This DOM query requires a top-page selector; use Stagehand locator commands for nested frames.",
      );
    return this.page.evaluate(
      `(()=>{const selector=${JSON.stringify(resolved)};const nodes=selector.startsWith("/")?[document.evaluate(selector,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue].filter(Boolean):document.querySelectorAll(selector);if(nodes.length!==1)throw Error('Selector must identify one element');const el=nodes[0];return ${expression}})()`,
    );
  }
}
