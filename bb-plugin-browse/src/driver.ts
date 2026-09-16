import { promises as fs } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Cdp } from "./cdp";
import { actOnElement } from "./element";
import { deepQuerySource, observeExpression } from "./observe";
import { safeUrl } from "./policy";
import { runtimePath } from "./runtime";
import { boundedDiagnostic, diagnosticUrl } from "./diagnostic-history";

type Ref = { backendNodeId: number; url?: string; sessionId?: string };

/** Deterministic browser control over CDP. No model, extension, or hosted service. */
export class BrowserDriver {
  private refs: Record<string, Ref> = {};
  private logs: unknown[] = [];
  private requests: unknown[] = [];
  private routes = new Map<string, { body?: string; block: boolean }>();
  private disposeEvents?: () => void;
  private contextId?: number;
  private frameSessionId?: string;
  private frameId?: string;
  private frameOffset = { x: 0, y: 0 };
  private runtimeEvents = false;
  private dialog?: { type: string; message: string; defaultPrompt?: string };

  private constructor(readonly cdp: Cdp, readonly root: string) {}

  static async connect(root: string, cdp: Cdp, signal: AbortSignal) {
    signal.throwIfAborted();
    const driver = new BrowserDriver(cdp, root);
    driver.disposeEvents = cdp.onEvent((method, params) => {
      if (method === "Network.requestWillBeSent") {
        driver.requests.push({
          id: params.requestId,
          url: diagnosticUrl(params.request.url),
          method: params.request.method,
        });
        driver.requests = driver.requests.slice(-200);
      }
      if (method === "Fetch.requestPaused") void driver.route(params);
      if (method === "Page.frameNavigated" && !params.frame?.parentId) {
        driver.refs = {};
        driver.contextId = undefined;
        driver.frameSessionId = undefined;
        driver.frameId = undefined;
        driver.frameOffset = { x: 0, y: 0 };
      }
      if (method === "Page.javascriptDialogOpening")
        driver.dialog = {
          type: String(params.type ?? "alert"),
          message: String(params.message ?? ""),
          ...(params.defaultPrompt
            ? { defaultPrompt: String(params.defaultPrompt) }
            : {}),
        };
      if (method === "Page.javascriptDialogClosed") driver.dialog = undefined;
      if (
        method === "Runtime.consoleAPICalled" ||
        method === "Runtime.exceptionThrown"
      ) {
        driver.logs.push({ method, params: boundedDiagnostic(params) });
        driver.logs = driver.logs.slice(-100);
      }
    });
    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Network.enable"),
    ]);
    return driver;
  }

  async close() {
    this.disposeEvents?.();
  }

  private async route(params: any) {
    const match = [...this.routes].find(([pattern]) =>
      new RegExp(
        "^" +
          pattern
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
      ).test(params.request.url),
    );
    const rule = match?.[1];
    await this.cdp
      .send(
        rule?.block
          ? "Fetch.failRequest"
          : rule?.body !== undefined
            ? "Fetch.fulfillRequest"
            : "Fetch.continueRequest",
        rule?.block
          ? { requestId: params.requestId, errorReason: "BlockedByClient" }
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

  private ref(value: string) {
    if (!value.startsWith("@")) return;
    const found = this.refs[value.slice(1)];
    if (!found)
      throw new Error("Unknown or stale reference. Take a fresh snapshot.");
    return found;
  }

  private async evaluate(expression: string) {
    if (this.frameSessionId) {
      const result = await this.cdp.sendToSession(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        this.frameSessionId,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text,
        );
      return result.result.value;
    }
    if (!this.contextId) return this.cdp.evaluate(expression);
    const result = await this.cdp.send("Runtime.evaluate", {
      expression,
      contextId: this.contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  }

  private queryExpression(selector: string, expression: string) {
    return `(()=>{${deepQuerySource}
const selector=${JSON.stringify(selector)};
const nodes=selector.startsWith('/')?[document.evaluate(selector,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue].filter(Boolean):deepQuery(selector);
if(nodes.length!==1)throw Error('Selector must identify one element; matched '+nodes.length);
const el=nodes[0];return ${expression}})()`;
  }

  private async callRef(ref: Ref, functionDeclaration: string, args: unknown[] = []) {
    const send = (method: string, params: Record<string, unknown>) =>
      ref.sessionId
        ? this.cdp.sendToSession(method, params, ref.sessionId)
        : this.cdp.send(method, params);
    const resolved = await send("DOM.resolveNode", {
      backendNodeId: ref.backendNodeId,
    });
    if (!resolved.object?.objectId) throw new Error("Referenced element is stale.");
    const result = await send("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result?.value;
  }

  private async point(selector: string) {
    const rect = await this.rect(selector);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  private async rect(selector: string) {
    const ref = this.ref(selector);
    if (ref) {
      const { quads } = ref.sessionId
        ? await this.cdp.sendToSession(
            "DOM.getContentQuads",
            { backendNodeId: ref.backendNodeId },
            ref.sessionId,
          )
        : await this.cdp.send("DOM.getContentQuads", {
            backendNodeId: ref.backendNodeId,
          });
      const q = quads?.[0];
      if (!q?.length) throw new Error("Referenced element is not visible.");
      const xs = [q[0], q[2], q[4], q[6]];
      const ys = [q[1], q[3], q[5], q[7]];
      const offset = ref.sessionId ? this.frameOffset : { x: 0, y: 0 };
      return {
        x: Math.min(...xs) + offset.x,
        y: Math.min(...ys) + offset.y,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    }
    const rect = await this.evaluate(
      this.queryExpression(
        selector,
        "(()=>{el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();if(r.width<1||r.height<1)throw Error('Element is not visible');return{x:r.x,y:r.y,width:r.width,height:r.height}})()",
      ),
    );
    return { x: rect.x + this.frameOffset.x, y: rect.y + this.frameOffset.y, width: rect.width, height: rect.height };
  }

  private async drag(source: string, target: string, placement: "auto" | "before" | "after" | "center" = "auto", signal?: AbortSignal) {
    const fromRect = await this.rect(source), toRect = await this.rect(target);
    const from = { x: fromRect.x + fromRect.width / 2, y: fromRect.y + fromRect.height / 2 };
    const vertical = Math.abs(from.y - (toRect.y + toRect.height / 2)) >= Math.abs(from.x - (toRect.x + toRect.width / 2));
    const forward = vertical ? from.y < toRect.y + toRect.height / 2 : from.x < toRect.x + toRect.width / 2;
    const edge = placement === "center" ? .5 : placement === "before" ? .15 : placement === "after" ? .85 : forward ? .85 : .15;
    const to = vertical ? { x: toRect.x + toRect.width / 2, y: toRect.y + toRect.height * edge } : { x: toRect.x + toRect.width * edge, y: toRect.y + toRect.height / 2 };
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from, buttons: 0 });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
    // Sortable widgets need real pointer movement to activate and move their placeholder.
    for (let step = 1; step <= 12; step++) {
      signal?.throwIfAborted();
      const progress = step / 12;
      await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress, button: "left", buttons: 1 });
    }
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
    return { source, target, placement, axis: vertical ? "vertical" : "horizontal" };
  }

  private async pointer(selector: string, count = 1, hover = false) {
    const { x, y } = await this.point(selector);
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      buttons: 0,
    });
    if (hover) return;
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: count,
    });
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: count,
    });
  }

  async element(
    action: "click" | "hover" | "fill",
    selector: string,
    value?: string,
    waitMs = 3000,
    signal = new AbortController().signal,
  ) {
    const ref = this.ref(selector);
    if (!ref && !this.contextId && !this.frameSessionId)
      return actOnElement(
        this.cdp,
        { kind: "element", action, selector, value, waitMs },
        signal,
      );
    const deadline = Date.now() + waitMs;
    for (;;) {
      signal.throwIfAborted();
      try {
        if (action === "fill") {
          if (value === undefined) throw new Error("Fill needs a value.");
          if (ref) {
            await this.callRef(
              ref,
              `function(){if(this.disabled||this.readOnly)throw Error('Field is disabled or read-only');this.focus();if(typeof this.select==='function')this.select();else{const r=document.createRange();r.selectNodeContents(this);const s=getSelection();s.removeAllRanges();s.addRange(r)}}`,
            );
          } else {
            await this.evaluate(
              this.queryExpression(
                selector,
                `(()=>{if(el.disabled||el.readOnly)throw Error('Field is disabled or read-only');el.focus();if(typeof el.select==='function')el.select()})()`,
              ),
            );
          }
          await this.cdp.send("Input.insertText", { text: value });
        } else await this.pointer(selector, 1, action === "hover");
        return JSON.stringify({ success: true, data: { action, selector } });
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await sleep(50, undefined, { signal });
      }
    }
  }

  private async navigate(url: string, signal?: AbortSignal) {
    this.refs = {};
    this.contextId = undefined;
    this.frameSessionId = undefined;
    this.frameId = undefined;
    this.frameOffset = { x: 0, y: 0 };
    await this.waitForNavigation(
      () => this.cdp.send("Page.navigate", { url: safeUrl(url) }, true, 30000),
      signal,
    );
  }

  private async waitForNavigation(
    action: () => Promise<unknown>,
    signal?: AbortSignal,
  ) {
    let settled = false;
    let resolveEvent!: () => void;
    const event = new Promise<void>((resolve) => (resolveEvent = resolve));
    const dispose = this.cdp.onEvent((method, params) => {
      if (
        method === "Page.loadEventFired" ||
        method === "Page.navigatedWithinDocument" ||
        (method === "Page.frameNavigated" && !params.frame?.parentId)
      ) {
        settled = true;
        resolveEvent();
      }
    });
    try {
      await action();
      if (!settled)
        await Promise.race([
          event,
          sleep(10_000, undefined, signal ? { signal } : undefined),
        ]);
    } finally {
      dispose();
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        const state = await this.cdp.evaluate("document.readyState", 3000);
        if (state === "interactive" || state === "complete") return;
      } catch {}
      await sleep(40, undefined, signal ? { signal } : undefined);
    }
    throw new Error("Navigation timed out.");
  }

  private async snapshot(interactive: boolean) {
    const { nodes } = this.frameSessionId
      ? await this.cdp.sendToSession(
          "Accessibility.getFullAXTree",
          {},
          this.frameSessionId,
        )
      : await this.cdp.send(
          "Accessibility.getFullAXTree",
          this.frameId ? { frameId: this.frameId } : {},
        );
    this.refs = {};
    const lines: string[] = [];
    const accessibleNames = new Set<string>();
    let index = 0;
    const interactiveRoles = new Set([
      "button",
      "link",
      "textbox",
      "combobox",
      "checkbox",
      "radio",
      "slider",
      "spinbutton",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "searchbox",
      "switch",
    ]);
    for (const node of nodes ?? []) {
      const role = String(node.role?.value ?? "");
      const name = String(node.name?.value ?? "").replace(/\s+/g, " ").trim();
      const isInteractive = interactiveRoles.has(role.toLowerCase());
      if (!role || role === "none" || role === "generic" || (!name && !isInteractive)) continue;
      if (interactive && !isInteractive) continue;
      if (isInteractive && name) accessibleNames.add(name.toLocaleLowerCase());
      const id = `0-${index++}`;
      const url = node.properties?.find((p: any) => p.name === "url")?.value?.value;
      if (node.backendDOMNodeId)
        this.refs[id] = {
          backendNodeId: node.backendDOMNodeId,
          ...(url ? { url } : {}),
          ...(this.frameSessionId ? { sessionId: this.frameSessionId } : {}),
        };
      const state = (node.properties ?? [])
        .filter((p: any) => ["checked", "disabled", "expanded", "selected", "value"].includes(p.name))
        .map((p: any) => `${p.name}=${String(p.value?.value)}`)
        .join(" ");
      lines.push(`${node.backendDOMNodeId ? `@${id} ` : ""}${role}${name ? `: ${JSON.stringify(name.slice(0, 300))}` : ""}${state ? ` (${state})` : ""}`);
      if (lines.length >= 1200) break;
    }
    if (interactive && lines.length < 1200) {
      // Accessibility trees omit non-semantic custom controls. Keep the
      // compact semantic snapshot, then add bounded visible DOM selectors.
      const observed = await this.evaluate(observeExpression).catch(() => null);
      for (const element of observed?.elements ?? []) {
        const label = String(element.label ?? "").replace(/\s+/g, " ").trim();
        const role = String(element.role || element.tag || "control").toLowerCase();
        if (!label || !element.selector || accessibleNames.has(label.toLocaleLowerCase())) continue;
        const state = [element.disabled ? "disabled=true" : "", element.readOnly ? "readonly=true" : "", typeof element.checked === "boolean" ? `checked=${element.checked}` : "", element.selected != null ? `selected=${element.selected}` : "", element.expanded != null ? `expanded=${element.expanded}` : ""].filter(Boolean).join(" ");
        lines.push(`selector ${JSON.stringify(element.selector)} ${role}: ${JSON.stringify(label.slice(0, 300))}${state ? ` (${state})` : ""}`);
        if (lines.length >= 1200) break;
      }
    }
    return {
      snapshot: lines.join("\n"),
      referenceSyntax: "Use @<id> refs or quoted DOM selectors. Reinspect after page changes.",
    };
  }

  private async dom(selector: string, expression: string) {
    const ref = this.ref(selector);
    if (ref)
      return this.callRef(ref, `function(){const el=this;return ${expression}}`);
    return this.evaluate(this.queryExpression(selector, expression));
  }

  private async setFiles(selector: string, files: string[]) {
    const ref = this.ref(selector);
    if (ref) {
      const params = { backendNodeId: ref.backendNodeId, files };
      return ref.sessionId
        ? this.cdp.sendToSession("DOM.setFileInputFiles", params, ref.sessionId)
        : this.cdp.send("DOM.setFileInputFiles", params);
    }
    const params = {
      expression: this.queryExpression(selector, "el"),
      returnByValue: false,
      ...(this.contextId ? { contextId: this.contextId } : {}),
    };
    const result = this.frameSessionId
      ? await this.cdp.sendToSession(
          "Runtime.evaluate",
          params,
          this.frameSessionId,
        )
      : await this.cdp.send("Runtime.evaluate", params);
    if (!result.result?.objectId) throw new Error("File input was not found.");
    const request = { objectId: result.result.objectId };
    const { nodeId } = this.frameSessionId
      ? await this.cdp.sendToSession(
          "DOM.requestNode",
          request,
          this.frameSessionId,
        )
      : await this.cdp.send("DOM.requestNode", request);
    return this.frameSessionId
      ? this.cdp.sendToSession(
          "DOM.setFileInputFiles",
          { nodeId, files },
          this.frameSessionId,
        )
      : this.cdp.send("DOM.setFileInputFiles", { nodeId, files });
  }

  private async press(keys: string) {
    const parts = keys.split("+");
    const key = parts.pop() || "";
    const modifiers = parts.reduce(
      (mask, part) =>
        mask |
        (/alt/i.test(part) ? 1 : 0) |
        (/control|ctrl/i.test(part) ? 2 : 0) |
        (/meta|command/i.test(part) ? 4 : 0) |
        (/shift/i.test(part) ? 8 : 0),
      0,
    );
    const codes: Record<string, number> = {
      Backspace: 8,
      Tab: 9,
      Enter: 13,
      Escape: 27,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Delete: 46,
    };
    const code = codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, modifiers, windowsVirtualKeyCode: code });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers, windowsVirtualKeyCode: code });
  }

  private async choose(field: string, query: string, option: string, signal?: AbortSignal) {
    await this.element("fill", field, query, 3000, signal);
    const deadline = Date.now() + 5000;
    for (;;) {
      signal?.throwIfAborted();
      const candidate = await this.evaluate(`(()=>{const wanted=${JSON.stringify(option)}.trim().toLocaleLowerCase();const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const text=e=>(e.getAttribute('aria-label')||e.getAttribute('data-value')||e.value||e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim();const candidates=[...document.querySelectorAll('[role="option"],[role="menuitem"],.ui-autocomplete li,.ui-menu-item,datalist option')].filter(visible);const exact=candidates.find(e=>text(e).toLocaleLowerCase()===wanted);if(!exact)return null;const target=exact.matches('option')?exact:(exact.querySelector('a,[role="option"]')||exact);target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=target.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,label:text(exact)}})()`);
      if (candidate) {
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: candidate.x, y: candidate.y, buttons: 0 });
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: candidate.x, y: candidate.y, button: "left", buttons: 1, clickCount: 1 });
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: candidate.x, y: candidate.y, button: "left", buttons: 0, clickCount: 1 });
        return { value: await this.dom(field, "el.value"), selected: candidate.label };
      }
      if (Date.now() >= deadline) throw new Error(`Autocomplete option ${JSON.stringify(option)} was not visible.`);
      await sleep(50, undefined, signal ? { signal } : undefined);
    }
  }

  private async setDate(field: string, value: string, signal?: AbortSignal) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date must use YYYY-MM-DD.");
    const [year, month, day] = value.split("-").map(Number);
    await this.pointer(field);
    const deadline = Date.now() + 5000;
    for (;;) {
      signal?.throwIfAborted();
      const result = await this.evaluate(`(()=>{const year=${year},month=${month},day=${day};const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};const picker=[...document.querySelectorAll('[role="dialog"],.ui-datepicker,[class*="datepicker"]')].find(visible);if(!picker)return null;const title=(picker.querySelector('.ui-datepicker-title,[class*="datepicker-title"]')?.textContent||'').trim();const parsed=new Date(Date.parse('1 '+title));if(!Number.isNaN(parsed.valueOf())){const delta=(year-parsed.getFullYear())*12+(month-1-parsed.getMonth());if(delta!==0){const next=delta>0;const nav=picker.querySelector(next?'.ui-datepicker-next,[aria-label*="next" i]':'.ui-datepicker-prev,[aria-label*="prev" i]');if(nav){nav.click();return{navigating:true}}}}const cells=[...picker.querySelectorAll('[data-date],td a,button')].filter(visible);const match=cells.find(e=>{const t=(e.getAttribute('data-date')||e.textContent||'').trim();const parent=e.closest('[data-year],[data-month]');const py=Number(parent?.getAttribute('data-year')),pm=Number(parent?.getAttribute('data-month'));return Number(t)===day&&(!Number.isFinite(py)||py===year)&&(!Number.isFinite(pm)||pm===month-1)&&!e.closest('.ui-datepicker-other-month')});if(!match)return{waiting:true};match.click();return{selected:true}})()`);
      if (result?.selected) return { value: await this.dom(field, "el.value") };
      if (Date.now() >= deadline) throw new Error(`Date ${value} was not available in the visible picker.`);
      await sleep(result?.navigating ? 20 : 50, undefined, signal ? { signal } : undefined);
    }
  }

  async execute(args: string[], signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const [cmd, ...a] = args;
    let data: unknown = {};
    switch (cmd) {
      case "open":
        await this.navigate(a[0], signal);
        data = { url: await this.cdp.evaluate("location.href") };
        break;
      case "reload":
        this.refs = {};
        await this.waitForNavigation(() => this.cdp.send("Page.reload"), signal);
        break;
      case "back":
      case "forward": {
        this.refs = {};
        const history = await this.cdp.send("Page.getNavigationHistory");
        const offset = cmd === "back" ? -1 : 1;
        const entry = history.entries?.[history.currentIndex + offset];
        if (entry)
          await this.waitForNavigation(
            () => this.cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }),
            signal,
          );
        break;
      }
      case "snapshot":
        data = await this.snapshot(a.includes("-i"));
        break;
      case "eval":
        data = { result: await this.evaluate(a.join(" ")) };
        break;
      case "click":
        await this.element("click", a[0], undefined, 3000, signal);
        break;
      case "dblclick":
        await this.pointer(a[0], 2);
        break;
      case "hover":
        await this.element("hover", a[0], undefined, 3000, signal);
        break;
      case "fill":
        await this.element("fill", a[0], a[1] ?? "", 3000, signal);
        break;
      case "type":
        if (a.length > 1) {
          const ref = this.ref(a[0]);
          if (ref) await this.callRef(ref, "function(){this.focus()}");
          else await this.dom(a[0], "el.focus()");
          await this.cdp.send("Input.insertText", { text: a[1] });
        } else await this.cdp.send("Input.insertText", { text: a[0] });
        break;
      case "press":
        await this.press(a.join(" "));
        break;
      case "keyboard":
        if (a[0] === "type") await this.cdp.send("Input.insertText", { text: a.slice(1).join(" ") });
        else await this.press(a.slice(1).join(" "));
        break;
      case "select": {
        const values = a.slice(1);
        data = { values: await this.dom(a[0], `(()=>{const values=${JSON.stringify(values)};for(const o of el.options)o.selected=values.includes(o.value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return [...el.selectedOptions].map(o=>o.value)})()`) };
        break;
      }
      case "choose":
        data = await this.choose(a[0], a[1] ?? "", a.slice(2).join(" "), signal);
        break;
      case "date":
        data = await this.setDate(a[0], a[1], signal);
        break;
      case "check":
      case "uncheck": {
        const checked = await this.dom(a[0], "!!el.checked");
        if (checked !== (cmd === "check")) await this.pointer(a[0]);
        break;
      }
      case "upload":
        await this.setFiles(a[0], a.slice(1));
        break;
      case "scroll": {
        const amount = Number(a[1] ?? 500);
        if (!Number.isFinite(amount)) throw new Error("Invalid scroll distance");
        const left = a[0] === "left", right = a[0] === "right";
        await this.evaluate(`scrollBy(${left ? -amount : right ? amount : 0},${a[0] === "up" ? -amount : left || right ? 0 : amount})`);
        break;
      }
      case "scrollintoview":
        await this.dom(a[0], "el.scrollIntoView({block:'center',inline:'center'})");
        break;
      case "drag": {
        const placement = a[2] ?? "auto";
        if (!["auto", "before", "after", "center"].includes(placement)) throw new Error("Drag placement must be auto, before, after, or center.");
        data = await this.drag(a[0], a[1], placement as "auto" | "before" | "after" | "center", signal);
        break;
      }
      case "wait":
        if (/^\d+$/.test(a[0])) await sleep(Math.min(Number(a[0]), 30000), undefined, signal ? { signal } : undefined);
        else {
          const deadline = Date.now() + 25000;
          while (true) {
            signal?.throwIfAborted();
            const found = await this.evaluate(`(()=>{${deepQuerySource}return deepQuery(${JSON.stringify(a[0])}).length>0})()`);
            if (found) break;
            if (Date.now() >= deadline) throw new Error("Selector wait timed out.");
            await sleep(50, undefined, signal ? { signal } : undefined);
          }
        }
        break;
      case "frame":
        if (a[0] === "main") {
          this.refs = {};
          this.contextId = undefined;
          this.frameSessionId = undefined;
          this.frameId = undefined;
          this.frameOffset = { x: 0, y: 0 };
        }
        else {
          const ref = this.ref(a[0]);
          const meta = ref
            ? await this.callRef(ref, "function(){return{src:this.src||'',name:this.name||''}}")
            : await this.dom(a[0], "({src:el.src||'',name:el.name||''})");
          const ownerBox = ref
            ? await this.callRef(ref, "function(){const r=this.getBoundingClientRect();return{x:r.x,y:r.y}}")
            : await this.dom(a[0], "(()=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y}})()");
          this.refs = {};
          const { frameTree } = await this.cdp.send("Page.getFrameTree");
          const children: any[] = [];
          const collect = (tree: any) => {
            for (const child of tree.childFrames ?? []) {
              children.push(child.frame);
              collect(child);
            }
          };
          collect(frameTree);
          const frame =
            children.find((value) => value.url === meta.src) ??
            children.find((value) => meta.name && value.name === meta.name) ??
            (children.length === 1 ? children[0] : undefined);
          if (frame?.id) {
            this.contextId = (await this.cdp.send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "bb-browse", grantUniveralAccess: false })).executionContextId;
            this.frameSessionId = undefined;
            this.frameId = frame.id;
          } else {
            const { targetInfos } = await this.cdp.send("Target.getTargets", {}, false);
            const target = targetInfos.find((value: any) => value.type === "iframe" && value.url === meta.src);
            if (!target) throw new Error("Selector is not an available frame.");
            this.frameSessionId = (await this.cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
            this.contextId = undefined;
            this.frameId = target.targetId;
          }
          this.frameOffset = ownerBox;
        }
        break;
      case "get": {
        const [what, target, attribute] = a;
        if (what === "title") data = { title: await this.evaluate("document.title") };
        else if (what === "url") data = { url: await this.evaluate("location.href") };
        else if (what === "text") data = { text: await this.dom(target, "el.innerText") };
        else if (what === "html") data = { html: await this.dom(target, "el.innerHTML") };
        else if (what === "value") data = { value: await this.dom(target, "el.value") };
        else if (what === "count") data = { count: target.startsWith("@") ? 1 : await this.evaluate(`(()=>{${deepQuerySource}return deepQuery(${JSON.stringify(target)}).length})()`) };
        else if (what === "box") data = await this.dom(target, "(()=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()");
        else if (what === "attr") data = { value: attribute === "href" && this.ref(target)?.url ? this.ref(target)?.url : await this.dom(target, `el.getAttribute(${JSON.stringify(attribute)})`) };
        else throw new Error(`Unsupported get operation: ${what}`);
        break;
      }
      case "is":
        data = { value: a[0] === "checked" ? await this.dom(a[1], "!!el.checked") : a[0] === "visible" ? await this.dom(a[1], "(()=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'})()") : await this.dom(a[1], "!el.disabled") };
        break;
      case "focus":
        await this.dom(a[0], "el.focus()");
        break;
      case "storage": {
        const storage = a[0] === "session" ? "sessionStorage" : "localStorage";
        if (a[1] === "set") await this.evaluate(`${storage}.setItem(${JSON.stringify(a[2])},${JSON.stringify(a[3])})`);
        else if (a[1] === "clear") await this.evaluate(`${storage}.clear()`);
        else data = { value: await this.evaluate(a[2] ? `${storage}.getItem(${JSON.stringify(a[2])})` : `Object.fromEntries(Object.entries(${storage}))`) };
        break;
      }
      case "cookies":
        if (a[0] === "clear") await this.cdp.send("Network.clearBrowserCookies");
        else if (a[0] === "set") await this.cdp.send("Network.setCookie", { name: a[1], value: a[2], url: await this.evaluate("location.href") });
        else data = { cookies: (await this.cdp.send("Network.getAllCookies")).cookies };
        break;
      case "network":
        if (a[0] === "requests") data = this.requests;
        else if (a[0] === "route") {
          if (!a[1]) throw new Error("A URL pattern is required");
          const bodyIndex = a.indexOf("--body");
          this.routes.set(a[1], { block: a.includes("--abort"), ...(bodyIndex < 0 ? {} : { body: a[bodyIndex + 1] ?? "" }) });
          await this.cdp.send("Fetch.enable", { patterns: [...this.routes.keys()].map((urlPattern) => ({ urlPattern })) });
        } else if (a[0] === "unroute") {
          if (a[1]) this.routes.delete(a[1]); else this.routes.clear();
          if (this.routes.size) await this.cdp.send("Fetch.enable", { patterns: [...this.routes.keys()].map((urlPattern) => ({ urlPattern })) });
          else await this.cdp.send("Fetch.disable");
        } else throw new Error("Use network requests, route <pattern> [--abort|--body text], or unroute [pattern]");
        break;
      case "dialog":
        if (a[0] === "status") data = { open: !!this.dialog, ...this.dialog };
        else {
          await this.cdp.send("Page.handleJavaScriptDialog", {
            accept: a[0] === "accept",
            promptText: a[1] ?? "",
          });
          this.dialog = undefined;
        }
        break;
      case "console":
      case "errors":
        if (!this.runtimeEvents) { await this.cdp.send("Runtime.enable"); this.runtimeEvents = true; }
        data = this.logs.filter((value: any) => cmd === "console" || value.method === "Runtime.exceptionThrown");
        if (a[0] === "--clear") this.logs = [];
        break;
      case "set":
        if (a[0] === "viewport") await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(a[1]), height: Number(a[2]), deviceScaleFactor: 1, mobile: false });
        else if (a[0] === "headers") await this.cdp.send("Network.setExtraHTTPHeaders", { headers: JSON.parse(a.slice(1).join(" ")) });
        else throw new Error(`Unsupported set operation: ${a[0]}`);
        break;
      case "a11y": {
        const source = await fs.readFile(join(runtimePath(this.root), "node_modules/axe-core/axe.min.js"), "utf8");
        data = await this.evaluate(`${source};axe.run().then(r=>({violations:r.violations,incomplete:r.incomplete}))`);
        break;
      }
      default:
        throw new Error(`Unsupported browser command: ${cmd}. Use Browse structured actions or eval.`);
    }
    signal?.throwIfAborted();
    return JSON.stringify({ success: true, data: data ?? null, error: null });
  }
}
