import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { setTimeout as sleep } from "node:timers/promises";

/** Private, read-only encoder connection. Browser input continues through CDP. */
export class SelkiesStream {
  onStop?: () => void;
  get isClosed(){return this.closed;}
  private child?: ChildProcess;
  get processId() {
    return this.child?.pid;
  }
  private socket?: WebSocket;
  private packets: Buffer[] = [];
  private bytes = 0;
  private error?: Error;
  private closed = false;
  private wake?: () => void;
  private lastRead = Date.now();
  private timer?: ReturnType<typeof setInterval>;
  private stopping?: Promise<void>;
  static async start(root: string, env: NodeJS.ProcessEnv) {
    const runtime = join(
      root,
      "selkies-runtime/opt/selkies/lib/python3.13/site-packages",
    );
    if (
      process.platform !== "linux" ||
      !env.DISPLAY ||
      !existsSync(join(runtime, "selkies"))
    )
      throw Error(
        "Video prototype dependencies are unavailable on this session host.",
      );
    const stream = new SelkiesStream();
    try {
      const listener = createServer();
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      const port = (listener.address() as { port: number }).port;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      stream.child = spawn(
        "python3",
        [
          "-m",
          "selkies",
          "--addr",
          "127.0.0.1",
          "--port",
          String(port),
          "--enable-basic-auth",
          "false",
          "--enable-https",
          "false",
          "--audio-enabled",
          "false",
          "--microphone-enabled",
          "false",
          "--webcam-enabled",
          "false",
          "--gamepad-enabled",
          "false",
          "--enable-clipboard",
          "false",
          "--file-transfers",
          "disabled",
          "--command-enabled",
          "false",
          "--enable-resize",
          "false",
          "--encoder",
          "h264enc",
          "--framerate",
          "60",
          "--video-bitrate",
          "8000",
          "--rate-control-mode",
          "cbr",
          "--video-streaming-mode",
          "false",
        ],
        {
          env: { ...env, PYTHONPATH: runtime },
          stdio: ["ignore", "ignore", "ignore"],
        },
      );
      stream.child.once("error", () =>
        stream.fail("Video encoder could not start."),
      );
      stream.child.once("exit", () => {
        if (!stream.closed) stream.fail("Video encoder stopped.");
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (stream.error) throw stream.error;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/api/websockets`, {
          maxPayload: 4 * 1024 * 1024,
          handshakeTimeout: 500,
        });
        const connected = await new Promise<boolean>((resolve) => {
          socket.once("open", () => resolve(true));
          socket.once("error", () => resolve(false));
        });
        if (!connected) {
          socket.terminate();
          await sleep(100);
          continue;
        }
        stream.socket = socket;
        socket.on("error", () =>
          stream.fail("Video encoder connection failed."),
        );
        socket.on("close", () => {
          if (!stream.closed) stream.fail("Video encoder disconnected.");
        });
        socket.on("message", (data, binary) => {
          if (!binary || stream.closed) return;
          const packet = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);
          // The pinned full-frame H.264 protocol has a ten-byte header.
          if (packet.length < 11 || packet[0] !== 4) return;
          if (
            stream.packets.length >= 60 ||
            stream.bytes + packet.length > 4 * 1024 * 1024
          ) {
            stream.fail("Video receiver fell behind.");
            return;
          }
          stream.packets.push(packet);
          stream.bytes += packet.length;
          stream.wake?.();
        });
        socket.send(
          "SETTINGS," +
            JSON.stringify({
              displayId: "primary",
              manual_resolution: true,
              manual_width: 1280,
              manual_height: 800,
              encoder: "h264enc",
              framerate: 60,
              video_bitrate: 8000,
              video_streaming_mode: false,
              video_fullcolor: false,
              useCssScaling: true,
              scaling_dpi: 96,
            }),
        );
        socket.send("START_VIDEO");
        stream.timer = setInterval(() => {
          if (Date.now() - stream.lastRead > 10000) void stream.stop();
        }, 2000);
        stream.timer.unref();
        return stream;
      }
      throw Error("Video encoder startup timed out.");
    } catch (error) {
      await stream.stop();
      throw error;
    }
  }
  private fail(message: string) {
    this.error = new Error(message);
    void this.stop();
  }
  async read(): Promise<string[]> { return (await this.readPackets()).map(packet=>packet.toString("base64")); }
  async readPackets(limit=8): Promise<Buffer[]> {
    this.lastRead = Date.now();
    if (this.error) throw this.error;
    if (this.closed) throw Error("Video stream closed.");
    if (!this.packets.length)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    this.wake = undefined;
    if (this.error) throw this.error;
    const packets = this.packets.splice(0, Math.max(1, Math.min(8, limit)));
    for (const packet of packets) {
      this.bytes -= packet.length;
      this.socket?.send(`CLIENT_FRAME_ACK ${packet.readUInt16BE(2)} 0`);
    }
    return packets;
  }
  stop(): Promise<void> {
    return (this.stopping ??= (async () => {
      this.closed = true;
      this.onStop?.();
      clearInterval(this.timer);
      this.wake?.();
      this.packets = [];
      this.bytes = 0;
      this.socket?.terminate();
      const child = this.child;
      if (child && child.exitCode === null && !child.signalCode) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => child.once("exit", () => resolve())),
          sleep(1000),
        ]);
        if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      }
    })());
  }
}
