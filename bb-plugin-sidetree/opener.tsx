import { useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  experimental_Icon as Icon,
  useRpc,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./components/ui/button";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "./components/ui/coarse-pointer-sizing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { CodeEditor } from "./code-editor";
import { usePortalScopeProps } from "./lib/portal-scope";
import { cn } from "./lib/utils";
import type { FileTarget, rpcContract } from "./server";
import { fileName } from "./tree";

const ITEM =
  "flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-state-hover data-[highlighted]:bg-state-hover";

function toTarget(
  path: string,
  source: PluginFileOpenerProps["source"],
): FileTarget {
  return {
    path,
    kind: source.kind,
    threadId: source.threadId,
    environmentId: source.environmentId,
    hostId: source.experimental_hostId,
  };
}

function downloadBytes(name: string, bytes: BlobPart, type: string): void {
  const blob = new Blob([bytes], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
}

export function FileOpener({
  path,
  source,
  experimental_lineRange,
}: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const portal = usePortalScopeProps();
  const target = toTarget(path, source);
  const name = fileName(path);

  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [sha256, setSha256] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<"utf8" | "base64">("utf8");
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [image, setImage] = useState(false);
  const [text, setText] = useState(true);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "delete" | null>("load");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = text && content !== saved;

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => {
      setNotice((current) => (current === message ? null : current));
    }, 1200);
  }, []);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const file = await rpc.call("read_file", target);
      setContent(file.content);
      setSaved(file.content);
      setSha256(file.sha256);
      setEncoding(file.encoding);
      setMimeType(file.mimeType);
      setImage(file.image);
      setText(file.text);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [rpc, target.path, target.kind, target.threadId, target.environmentId, target.hostId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (!text || sha256 === null || !dirty) return;
    setBusy("save");
    setError(null);
    try {
      const result = await rpc.call("write_file", {
        ...target,
        content,
        expectedSha256: sha256,
      });
      if (result.outcome === "conflict") {
        setError("This file changed on disk. Reload, then save again.");
        return;
      }
      setSaved(content);
      setSha256(result.sha256);
      flash("Saved");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function copyContents(): Promise<void> {
    if (!text) return;
    await navigator.clipboard.writeText(content);
    flash("Copied");
  }

  async function copyPath(): Promise<void> {
    await navigator.clipboard.writeText(path);
    flash("Copied path");
  }

  function download(): void {
    if (encoding === "base64") {
      const binary = atob(content);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      downloadBytes(name, bytes, mimeType ?? "application/octet-stream");
      return;
    }
    downloadBytes(name, content, mimeType ?? "text/plain;charset=utf-8");
  }

  async function remove(): Promise<void> {
    setBusy("delete");
    setError(null);
    try {
      await rpc.call("remove_file", target);
      setDeleted(true);
      setConfirmDelete(false);
      setSaved(content);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-1.5 max-md:pointer-coarse:h-9">
        <p className="min-w-0 flex-1 truncate px-1.5 text-xs text-muted-foreground">
          {path}
          {dirty ? " · edited" : ""}
        </p>
        {notice !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground">{notice}</span>
        ) : null}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={deleted || busy === "load"}
              aria-label="File actions"
              className={COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS}
            >
              <Icon name="MoreHorizontal" fallback="MoreHorizontal" aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              {...portal}
              align="end"
              sideOffset={4}
              className="z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {text ? (
                <DropdownMenu.Item
                  className={ITEM}
                  disabled={!dirty || busy !== null}
                  onSelect={() => void save()}
                >
                  Save
                </DropdownMenu.Item>
              ) : null}
              {text ? (
                <DropdownMenu.Item className={ITEM} onSelect={() => void copyContents()}>
                  Copy contents
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Item className={ITEM} onSelect={download}>
                Download
              </DropdownMenu.Item>
              <DropdownMenu.Item className={ITEM} onSelect={() => void copyPath()}>
                Copy path
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                className={cn(ITEM, "text-destructive focus:bg-destructive/15")}
                onSelect={() => setConfirmDelete(true)}
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {error !== null ? (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className={cn("min-h-0 flex-1", text ? "" : "overflow-auto")}>
        {deleted ? (
          <p className="p-3 text-sm text-muted-foreground">{name} was deleted.</p>
        ) : busy === "load" ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : image ? (
          <img
            alt={name}
            src={
              encoding === "base64"
                ? `data:${mimeType ?? "image/*"};base64,${content}`
                : undefined
            }
            className="m-3 max-h-full max-w-full"
          />
        ) : text ? (
          <CodeEditor
            path={path}
            value={content}
            onChange={setContent}
            onSave={() => void save()}
            readOnly={deleted || busy === "save"}
            lineRange={experimental_lineRange}
          />
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            Binary file · {name}
          </p>
        )}
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent hideCloseButton>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              This removes the file from disk. It cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === "delete"}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
