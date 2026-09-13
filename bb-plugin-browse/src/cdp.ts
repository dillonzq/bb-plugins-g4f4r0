import WebSocket from "ws";
export class Cdp {
  private ws: WebSocket;
  private serial = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(method: string, params: any) => void>();
  onEvent(fn: (method: string, params: any) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  onDisconnect?: () => void;
  private frameListener?: (params: any) => void;
  private frameFailure?: () => void;
  sessionId?: string;
  targetId?: string;
  private constructor(endpoint: string) {
    this.ws = new WebSocket(endpoint, { maxPayload: 40 * 1024 * 1024 });
    this.ws.on("message", (raw) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.method)
        for (const listener of this.listeners) listener(m.method, m.params);
      if (m.method === "Page.screencastFrame") this.frameListener?.(m.params);
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
    this.ws.on("close", () => this.fail());
    this.ws.on("error", () => this.fail());
  }
  static async connect(endpoint: string, managed = false): Promise<Cdp> {
    const c = new Cdp(endpoint);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        c.close();
        reject(new Error("Browser connection timed out"));
      }, 10000);
      c.ws.once("open", () => {
        clearTimeout(t);
        resolve();
      });
      c.ws.once("error", () => {
        clearTimeout(t);
        reject(
          new Error(
            "Browser connection unavailable. Reconnect the desktop session.",
          ),
        );
      });
    });
    try {
      const { targetInfos } = await c.send("Target.getTargets", {}, false);
      const pages = targetInfos.filter(
        (t: any) => t.type === "page" || t.type === "webview",
      );
      if (managed) {
        // Managed profiles may restore old tabs after a crash. Own a fresh target explicitly.
        const fresh = await c.send(
          "Target.createTarget",
          { url: "about:blank" },
          false,
        );
        c.targetId = fresh.targetId;
        for (const page of pages)
          await c.send(
            "Target.closeTarget",
            { targetId: page.targetId },
            false,
          );
      } else {
        if (pages.length !== 1)
          throw new Error(`Expected one leased tab; found ${pages.length}.`);
        c.targetId = pages[0].targetId;
      }
      const r = await c.send(
        "Target.attachToTarget",
        { targetId: c.targetId, flatten: true },
        false,
      );
      c.sessionId = r.sessionId;
      return c;
    } catch (e) {
      c.close();
      throw e;
    }
  }
  send(
    method: string,
    params: Record<string, unknown> = {},
    page = true,
    timeoutMs = 15000,
  ): Promise<any> {
    if (this.ws.readyState !== WebSocket.OPEN)
      return Promise.reject(
        new Error("Browser disconnected; reconnect this session."),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(page && this.sessionId ? { sessionId: this.sessionId } : {}),
        }),
      );
    });
  }
  async evaluate(expression: string, timeoutMs = 15000) {
    const r = await this.send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      true,
      timeoutMs,
    );
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
  }
  async captureFrame(): Promise<string> {
    let timer: ReturnType<typeof setTimeout>;
    const frame = new Promise<any>((resolve, reject) => {
      this.frameListener = resolve;
      this.frameFailure = () =>
        reject(new Error("Browser disconnected during capture"));
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "No screenshot frame arrived. Keep this thread and its native browser tab visible in BB Desktop.",
            ),
          ),
        6000,
      );
    });
    void frame.catch(() => {});
    try {
      await this.send("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
      });
      const result = await frame;
      await this.send("Page.screencastFrameAck", {
        sessionId: result.sessionId,
      });
      return result.data;
    } finally {
      clearTimeout(timer!);
      this.frameListener = undefined;
      this.frameFailure = undefined;
      await this.send("Page.stopScreencast").catch(() => {});
    }
  }
  private fail() {
    this.onDisconnect?.();
    this.onDisconnect = undefined;
    this.frameFailure?.();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Browser disconnected; the tab has been preserved."));
    }
    this.pending.clear();
  }
  close() {
    this.fail();
    this.ws.terminate();
  }
}
