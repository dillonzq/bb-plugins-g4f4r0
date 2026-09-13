import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button, buttonVariants } from "./components/ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "./components/ui/coarse-pointer-sizing";
import { Input } from "./components/ui/input";
import { Skeleton } from "./components/ui/skeleton";
import { FileGlyph } from "./file-icon";
import { cn } from "./lib/utils";
import type { Entry, Root, rpcContract } from "./server";
import { fileIconToken, folderIconName } from "./tree";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

/** 14px slot — search glyph, chevron, folder, and file all share it. */
const SLOT = "size-3.5 shrink-0";

/**
 * Ghost sm (h-8, rounded-md, hover:bg-state-hover) with tree overrides:
 * start-aligned, 10px inset to match the search icon, 14px glyphs.
 */
const ROW = cn(
  "h-8 w-full min-w-0 justify-start gap-1 px-2.5 font-normal text-sm",
  "no-underline hover:no-underline",
  "[&_svg]:size-3.5",
  "max-md:pointer-coarse:h-10",
);

function Indent({ depth }: { depth: number }) {
  return <span className="shrink-0" style={{ width: depth * 12 }} aria-hidden="true" />;
}

function ChevronSlot({ open }: { open?: boolean }) {
  if (open === undefined) {
    return <span className={SLOT} aria-hidden="true" />;
  }
  return (
    <Icon
      name="ChevronRight"
      fallback="ChevronRight"
      className={cn(SLOT, "text-muted-foreground transition-transform", open && "rotate-90")}
      aria-hidden
    />
  );
}

function TreeSkeleton({
  rows,
  depth = 0,
}: {
  rows: number;
  depth?: number;
}) {
  return (
    <ul className="m-0 list-none p-0" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="min-w-0">
          <div className={cn(ROW, "flex pointer-events-none items-center hover:bg-transparent")}>
            <Indent depth={depth} />
            <span className={SLOT} aria-hidden="true" />
            <Skeleton className="size-3.5 shrink-0 rounded-sm" />
            <Skeleton
              className="h-3 rounded-sm"
              style={{ width: `${42 + ((index * 17) % 36)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusLine({
  depth = 0,
  tone = "muted",
  children,
}: {
  depth?: number;
  tone?: "muted" | "destructive";
  children: string;
}) {
  return (
    <p
      role={tone === "destructive" ? "alert" : undefined}
      className={cn(
        "flex h-8 items-center px-2.5 text-sm",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Indent depth={depth} />
      {children}
    </p>
  );
}

function TreeLevel({
  rpc,
  threadId,
  environmentId,
  relativePath,
  depth,
  expanded,
  onToggle,
  cache,
}: {
  rpc: Rpc;
  threadId: string;
  environmentId: string;
  relativePath: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  cache: Map<string, Entry[]>;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(
    () => cache.get(relativePath) ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = cache.get(relativePath);
    if (cached !== undefined) {
      setEntries(cached);
      return;
    }
    let cancelled = false;
    void rpc
      .call("list_dir", { threadId, relativePath })
      .then((result) => {
        if (cancelled) return;
        cache.set(relativePath, result.entries);
        setEntries(result.entries);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [cache, relativePath, rpc, threadId]);

  if (error !== null) {
    return (
      <StatusLine depth={depth} tone="destructive">
        {error}
      </StatusLine>
    );
  }
  if (entries === null) {
    return <TreeSkeleton rows={depth === 0 ? 8 : 4} depth={depth} />;
  }
  if (entries.length === 0) {
    return <StatusLine depth={depth}>Empty</StatusLine>;
  }

  return (
    <ul className="m-0 list-none p-0">
      {entries.map((entry) => {
        const open = expanded.has(entry.relativePath);
        if (entry.kind === "directory") {
          return (
            <li key={entry.relativePath} className="min-w-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={ROW}
                aria-expanded={open}
                aria-label={entry.name}
                onClick={() => onToggle(entry.relativePath)}
              >
                <Indent depth={depth} />
                <ChevronSlot open={open} />
                <Icon
                  name={folderIconName(open)}
                  fallback="FolderOpen"
                  className={cn(SLOT, "text-muted-foreground")}
                  aria-hidden
                />
                <span className="min-w-0 truncate">{entry.name}</span>
              </Button>
              {open ? (
                <TreeLevel
                  rpc={rpc}
                  threadId={threadId}
                  environmentId={environmentId}
                  relativePath={entry.relativePath}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  cache={cache}
                />
              ) : null}
            </li>
          );
        }
        return (
          <li key={entry.relativePath} className="min-w-0">
            <FileLink
              target={{
                kind: "workspace",
                environmentId,
                path: entry.relativePath,
              }}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), ROW)}
            >
              <Indent depth={depth} />
              <ChevronSlot />
              <FileGlyph token={fileIconToken(entry.relativePath)} />
              <span className="min-w-0 truncate">{entry.name}</span>
            </FileLink>
          </li>
        );
      })}
    </ul>
  );
}

function FilterHits({
  environmentId,
  entries,
}: {
  environmentId: string;
  entries: Entry[];
}) {
  if (entries.length === 0) {
    return <StatusLine>No matching files</StatusLine>;
  }
  return (
    <ul className="m-0 list-none p-0">
      {entries.map((entry) => (
        <li key={entry.relativePath} className="min-w-0">
          <FileLink
            target={{
              kind: "workspace",
              environmentId,
              path: entry.relativePath,
            }}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), ROW)}
            title={entry.relativePath}
          >
            {entry.kind === "directory" ? (
              <Icon
                name={folderIconName(false)}
                fallback="FolderOpen"
                className={cn(SLOT, "text-muted-foreground")}
                aria-hidden
              />
            ) : (
              <FileGlyph token={fileIconToken(entry.relativePath)} />
            )}
            <span className="min-w-0 truncate">{entry.relativePath}</span>
          </FileLink>
        </li>
      ))}
    </ul>
  );
}

function FilesPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const cache = useRef(new Map<string, Entry[]>());
  const [root, setRoot] = useState<Root | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<Entry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("workspace_root", { threadId })
      .then((next) => {
        if (cancelled) return;
        setRoot(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  useEffect(() => {
    const query = filter.trim();
    if (query === "") {
      setHits(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void rpc
        .call("search_files", { threadId, query })
        .then((result) => {
          if (cancelled) return;
          setHits(result.entries);
          setSearching(false);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setSearching(false);
          setSearchError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filter, rpc, threadId]);

  const onToggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (error !== null && root === null) {
    return (
      <p role="alert" className="p-2.5 text-sm text-destructive">
        {error}
      </p>
    );
  }
  const filtering = filter.trim() !== "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5">
      <div className="relative min-w-0 shrink-0">
        <Icon
          name="Search"
          className={cn(
            "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground",
            COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
          )}
          aria-hidden
        />
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter !== "") {
              event.stopPropagation();
              setFilter("");
            }
          }}
          placeholder="Search files"
          aria-label="Search files"
          data-sidetree-search=""
          spellCheck={false}
          className={cn(
            "h-8 pl-8 pr-8 text-sm focus-visible:ring-0 max-md:pointer-coarse:h-10",
            "[&::-webkit-search-cancel-button]:hidden",
          )}
        />
        {searching ? (
          <Icon
            name="Spinner"
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground",
              COARSE_POINTER_ICON_SIZE_CLASS,
            )}
            aria-hidden
          />
        ) : filter !== "" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            className={cn(
              COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
              "absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFilter("")}
          >
            <Icon name="X" fallback="X" aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {root === null ? (
          <TreeSkeleton rows={8} />
        ) : filtering ? (
          searchError !== null ? (
            <StatusLine tone="destructive">{searchError}</StatusLine>
          ) : searching && hits === null ? (
            <TreeSkeleton rows={6} />
          ) : (
            <FilterHits environmentId={root.environmentId} entries={hits ?? []} />
          )
        ) : (
          <TreeLevel
            rpc={rpc}
            threadId={threadId}
            environmentId={root.environmentId}
            relativePath=""
            depth={0}
            expanded={expanded}
            onToggle={onToggle}
            cache={cache.current}
          />
        )}
      </div>
    </div>
  );
}

const HIDDEN = "data-sidetree-hide";
const ACTIONS = "data-sidetree-actions";
const STYLE_ID = "sidetree-host-chrome";
const OPEN_IN_EDITOR =
  'button[aria-label="Open in editor"], button[aria-label^="Open in editor ("]';
const PREVIEW_ACTIONS = [
  'button[aria-label="Refresh file"]',
  'button[aria-label="Refreshing file"]',
  'button[aria-label="Copy file contents"]',
  'button[aria-label="Copy CSV"]',
  'button[aria-label="Copy markdown"]',
  'button[aria-label="Copy HTML source"]',
  'button[aria-label="Open in external browser"]',
].join(", ");

function markHidden(node: Element | null): void {
  if (!(node instanceof HTMLElement) || node.hasAttribute(HIDDEN)) return;
  node.setAttribute(HIDDEN, "");
  node.hidden = true;
}

function pinPreviewActionsRight(): void {
  const name = document.querySelector('button[aria-label="Copy file path"]');
  if (!(name instanceof HTMLElement) || name.parentElement === null) return;
  const row = name.parentElement;
  const action = row.querySelector(PREVIEW_ACTIONS);
  if (!(action instanceof HTMLElement)) return;
  let cluster: HTMLElement = action;
  while (cluster.parentElement !== null && cluster.parentElement !== row) {
    cluster = cluster.parentElement;
  }
  if (cluster.parentElement !== row || cluster === name) return;
  for (const node of row.querySelectorAll(`[${ACTIONS}]`)) {
    if (node !== cluster) node.removeAttribute(ACTIONS);
  }
  cluster.setAttribute(ACTIONS, "");
}

function hideHostChrome(): () => void {
  const hide = () => {
    const inputs = document.querySelectorAll(
      'input[role="combobox"][aria-label^="Search files"], input[placeholder="No searchable source"]',
    );
    for (const input of inputs) {
      if (input instanceof HTMLElement && input.hasAttribute("data-sidetree-search")) {
        continue;
      }
      markHidden(input.parentElement);
    }
    for (const button of document.querySelectorAll(OPEN_IN_EDITOR)) {
      markHidden(button);
    }
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      const label = item.textContent?.trim() ?? "";
      if (label === "Open externally" || label === "Open in") {
        markHidden(item);
      }
    }
    pinPreviewActionsRight();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== "o"
    ) {
      return;
    }
    if (document.querySelector(OPEN_IN_EDITOR) === null) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `[${ACTIONS}]{margin-left:auto}`;
  document.head.appendChild(style);
  hide();
  const observer = new MutationObserver(hide);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("keydown", onKeyDown, true);
    style.remove();
    for (const node of document.querySelectorAll(`[${HIDDEN}]`)) {
      if (node instanceof HTMLElement) {
        node.hidden = false;
        node.removeAttribute(HIDDEN);
      }
    }
    for (const node of document.querySelectorAll(`[${ACTIONS}]`)) {
      node.removeAttribute(ACTIONS);
    }
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "hide-host-chrome",
    mount() {
      return hideHostChrome();
    },
  });
  app.slots.threadPanelAction({
    id: "files",
    title: "Files",
    icon: "FolderOpen",
    layout: "flush",
    component: FilesPanel,
  });
});
