import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "./cdp";

/** Start listening before the single click; never retry a download trigger. */
export async function downloadFromClick(
  cdp: Cdp,
  root: string,
  click: () => Promise<void>,
  signal: AbortSignal,
) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  let guid: string | undefined,
    resolve!: (path: string) => void,
    reject!: (error: Error) => void;
  const completed = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void completed.catch(() => {});
  const off = cdp.onEvent((method, params) => {
    if (method === "Browser.downloadWillBegin" && !guid) guid = params.guid;
    if (method === "Browser.downloadProgress" && params.guid === guid) {
      if (params.totalBytes > 128 * 1024 * 1024) {
        void cdp
          .send("Browser.cancelDownload", { guid }, false)
          .catch(() => {});
        reject(new Error("Download exceeds 128 MB"));
      }
      if (params.state === "completed" && /^[a-zA-Z0-9-]+$/.test(guid!))
        resolve(join(root, guid!));
      if (params.state === "canceled")
        reject(new Error("Browser download was cancelled"));
    }
  });
  const abort = () => reject(new Error("Download cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => reject(new Error("No completed browser download within 60 seconds")),
    60000,
  );
  try {
    signal.throwIfAborted();
    await cdp.send(
      "Browser.setDownloadBehavior",
      { behavior: "allowAndName", downloadPath: root, eventsEnabled: true },
      false,
    );
    await click();
    return await completed;
  } finally {
    clearTimeout(timer);
    off();
    signal.removeEventListener("abort", abort);
    if (guid)
      await cdp.send("Browser.cancelDownload", { guid }, false).catch(() => {});
    await cdp
      .send("Browser.setDownloadBehavior", { behavior: "deny" }, false)
      .catch(() => {});
  }
}
