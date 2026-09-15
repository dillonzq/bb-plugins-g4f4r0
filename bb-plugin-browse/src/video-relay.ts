import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import type { SelkiesStream } from "./selkies";
/** Private host-to-server transport, never exposed directly to browser clients. */
export async function videoRelay(
  stream: SelkiesStream,
  info: () => Promise<{ url: string; loading: boolean }>,
) {
  const token = randomBytes(32).toString("hex");
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 });
  let claimed = false,
    closed = false;
  if (stream.isClosed) throw Error("Video stream closed");
  const stop = () => {
    if (closed) return;
    closed = true;
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    server.close();
  };
  stream.onStop = stop;
  server.on("upgrade", (req, socket, head) => {
    if (
      closed ||
      claimed ||
      req.url !== "/video" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    claimed = true;
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit("connection", ws, req),
    );
  });
  sockets.on("connection", (ws) => {
    let begin: () => void = () => {};
    let begun = false;
    const pending: number[] = [];
    const sentAt:number[]=[];let ackMs=0;
    let bytes = 0,
      lastAck = Date.now(),
      done = false,
      wake: (() => void) | undefined,
      metadataAt = 0,
      metadataPending = false;
    ws.on("message", (data, binary) => {
      if (!binary && String(data) === "start" && !begun) {
        begun = true;
        begin();
        return;
      }
      if (binary || String(data) !== "ack" || !pending.length) {
        ws.close(1008, "Invalid acknowledgement");
        return;
      }
      bytes -= pending.shift()!;ackMs=Math.max(ackMs,performance.now()-(sentAt.shift()??performance.now()));
      lastAck = Date.now();
      wake?.();
    });
    ws.on("error", () => ws.close());
    ws.on("close", () => {
      done = true;
      wake?.();
      void stream.stop();
    });
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Video handshake timed out")),
            2000,
          );
          begin = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        while (!done && !closed) {
          if (pending.length && Date.now() - lastAck > 5000)
            throw Error("Video receiver stalled");
          if (pending.length >= 6 || bytes >= 1024 * 1024) {
            await new Promise<void>((r) => {
              const timer = setTimeout(r, 100);
              wake = () => {
                clearTimeout(timer);
                r();
              };
            });
            continue;
          }
          const packets = await stream.readPackets(6 - pending.length);
          if (done || closed) break;
          if (!metadataPending && Date.now() - metadataAt > 500) {
            metadataAt = Date.now();
            metadataPending = true;
            void info()
              .then((metadata) => {
                if (!done && !closed)
                  ws.send(JSON.stringify({ ...metadata, transport: "binary",videoAckMs:ackMs }));
              })
              .catch(() => {})
              .finally(() => {
                ackMs=0;
                metadataPending = false;
              });
          }
          for (const packet of packets) {
            if (!pending.length) lastAck = Date.now();
            pending.push(packet.length);sentAt.push(performance.now());
            bytes += packet.length;
            ws.send(packet);
          }
        }
      } catch {
        ws.close(1011, "Video unavailable");
      } finally {
        await stream.stop();
      }
    })();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (e) {
    stop();
    throw e;
  }
  if (stream.isClosed) {
    stop();
    throw Error("Video stream closed");
  }
  return { port: (server.address() as { port: number }).port, token };
}
export async function connectVideoRelay(endpoint: {
  port: number;
  token: string;
}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${endpoint.port}/video`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    handshakeTimeout: 700,
    maxPayload: 4 * 1024 * 1024,
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", (e) => {
      ws.terminate();
      reject(e);
    });
  });
}
