import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
/** One authenticated upstream, multiple private host-local CDP consumers. */
export class Bridge {
  private upstream: WebSocket;
  private http: Server;
  private wss: WebSocketServer;
  private serial = 0;
  private pending = new Map<
    number,
    { client: WebSocket; id: number; method: string; targetId?: string }
  >();
  private owners = new Map<string, WebSocket>();
  private targets = new Map<string, string>();
  private token = randomBytes(24).toString("hex");
  endpoint = "";
  trace: string[] = [];
  onDisconnect?: () => void;
  private closed = false;
  private constructor(endpoint: string) {
    this.upstream = new WebSocket(endpoint, { maxPayload: 40 * 1024 * 1024 });
    this.http = createServer((_, r) => {
      r.writeHead(404);
      r.end();
    });
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 8 * 1024 * 1024,
    });
    this.http.on("upgrade", (req, socket, head) => {
      if (req.url !== `/${this.token}` || req.headers.origin) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) =>
        this.wss.emit("connection", ws),
      );
    });
    this.wss.on("connection", (client) => {
      client.on("error", () => {});
      client.on("message", (raw) => {
        let m: any;
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (typeof m.id !== "number" || typeof m.method !== "string") return;
        if (
          [
            "Browser.close",
            "Target.closeTarget",
            "Target.createTarget",
            "Target.createBrowserContext",
            "Target.disposeBrowserContext",
          ].includes(m.method)
        ) {
          client.send(
            JSON.stringify({
              id: m.id,
              error: {
                code: -32000,
                message:
                  "Manage browser tabs through the Browse session API.",
              },
            }),
          );
          return;
        }
        if (this.upstream.readyState !== WebSocket.OPEN) {
          client.close();
          return;
        }
        this.trace.push(m.method);
        this.trace = this.trace.slice(-80);
        const id = ++this.serial;
        this.pending.set(id, {
          client,
          id: m.id,
          method: m.method,
          targetId: m.params?.targetId ?? this.targets.get(m.sessionId),
        });
        this.upstream.send(
          JSON.stringify(
            m.method === "Target.getTargetInfo"
              ? { id, method: "Target.getTargets", params: {} }
              : { ...m, id },
          ),
        );
      });
      client.on("close", () => {
        for (const [id, p] of this.pending)
          if (p.client === client) this.pending.delete(id);
        for (const [id, c] of this.owners)
          if (c === client) {
            this.owners.delete(id);
            this.targets.delete(id);
          }
      });
    });
    this.upstream.on("message", (raw) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof m.id === "number") {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) this.trace.push(JSON.stringify(m.error));
        if (p.method === "Target.attachToTarget" && m.result?.sessionId) {
          this.owners.set(m.result.sessionId, p.client);
          if (p.targetId) this.targets.set(m.result.sessionId, p.targetId);
        }
        if (p.method === "Target.getTargetInfo" && m.result) {
          const pages = m.result.targetInfos ?? [];
          const targetInfo =
            pages.find((t: any) => t.targetId === p.targetId) ??
            (!p.targetId && pages.length === 1 ? pages[0] : undefined);
          m = targetInfo
            ? { id: m.id, result: { targetInfo } }
            : {
                id: m.id,
                error: { code: -32000, message: "Bound tab is unavailable" },
              };
        }
        if (p.client.readyState === WebSocket.OPEN)
          p.client.send(JSON.stringify({ ...m, id: p.id }));
      } else {
        const owner = m.sessionId ? this.owners.get(m.sessionId) : undefined;
        for (const client of this.wss.clients)
          if (
            client.readyState === WebSocket.OPEN &&
            (!m.sessionId || owner === client)
          )
            client.send(raw);
      }
    });
    this.upstream.on("error", () => this.close());
    this.upstream.on("close", () => this.close());
  }
  static async open(endpoint: string) {
    const b = new Bridge(endpoint);
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error("Desktop connection timed out")),
          10000,
        );
        b.upstream.once("open", () => {
          clearTimeout(t);
          resolve();
        });
        b.upstream.once("error", () => {
          clearTimeout(t);
          reject(new Error("Desktop connection rejected. Reconnect the tab."));
        });
      });
      await new Promise<void>((resolve, reject) => {
        b.http.once("error", reject);
        b.http.listen(0, "127.0.0.1", resolve);
      });
      const address = b.http.address();
      if (!address || typeof address === "string")
        throw new Error("Local browser adapter unavailable");
      b.endpoint = `ws://127.0.0.1:${address.port}/${b.token}`;
      return b;
    } catch (e) {
      b.close();
      throw e;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onDisconnect?.();
    this.upstream.terminate();
    for (const c of this.wss.clients) c.terminate();
    this.pending.clear();
    this.owners.clear();
    this.wss.close();
    this.http.close();
  }
}
