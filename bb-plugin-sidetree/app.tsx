import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "./components/ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "./components/ui/coarse-pointer-sizing";
import { Input } from "./components/ui/input";
import { Skeleton } from "./components/ui/skeleton";
import { FileGlyph, FolderGlyph } from "./file-icon";
import { FileOpener } from "./opener";
import { SourceRenderer } from "./source-renderer";
import { ScrollEdgeFades, useOverflowEdges } from "./scroll-fade";
import { cn } from "./lib/utils";
import type { Entry, Root, rpcContract } from "./server";
import { fileIconToken, OPENER_EXTENSIONS, defaultFolderToOpen } from "./tree";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

/** Ghost row; one spacing token under the search field. */
const LINE = "flex w-full min-w-0 items-center";
const ITEM = cn(
  "flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-sm font-normal text-foreground",
  "appearance-none cursor-pointer border-0 bg-transparent no-underline hover:no-underline hover:bg-state-hover",
  "focus-visible:bg-state-hover focus-visible:outline-none",
  "max-md:pointer-coarse:h-9",
);

function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span
      className="flex h-7 shrink-0 self-stretch max-md:pointer-coarse:h-9"
      aria-hidden="true"
    >
      {Array.from({ length: depth }, (_, index) => (
        <span key={index} className="relative w-3 self-stretch">
          <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        </span>
      ))}
    </span>
  );
}

function TreeLine({
  depth,
  children,
}: {
  depth: number;
  children: ReactNode;
}) {
  return (
    <div className={LINE}>
      <IndentGuides depth={depth} />
      {children}
    </div>
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
          <div className={cn(LINE, "pointer-events-none")}>
            <IndentGuides depth={depth} />
            <div className={cn(ITEM, "hover:bg-transparent")}>
              <Skeleton className="size-4 shrink-0 rounded-[3px]" />
              <Skeleton
                className="h-3 rounded-sm"
                style={{ width: `${42 + ((index * 17) % 36)}%` }}
              />
            </div>
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
        "flex h-7 items-center px-2 text-sm max-md:pointer-coarse:h-9",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <IndentGuides depth={depth} />
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
  onAutoOpen,
  cache,
}: {
  rpc: Rpc;
  threadId: string;
  environmentId: string;
  relativePath: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onAutoOpen: (path: string) => void;
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

  useEffect(() => {
    if (depth !== 0 || entries === null) return;
    const folder = defaultFolderToOpen(entries);
    if (folder !== null) onAutoOpen(folder);
  }, [depth, entries, onAutoOpen]);

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
              <TreeLine depth={depth}>
                <button
                  type="button"
                  className={ITEM}
                  aria-expanded={open}
                  aria-label={entry.name}
                  onClick={() => onToggle(entry.relativePath)}
                >
                  <FolderGlyph open={open} />
                  <span className="min-w-0 truncate">{entry.name}</span>
                </button>
              </TreeLine>
              {open ? (
                <TreeLevel
                  rpc={rpc}
                  threadId={threadId}
                  environmentId={environmentId}
                  relativePath={entry.relativePath}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  onAutoOpen={onAutoOpen}
                  cache={cache}
                />
              ) : null}
            </li>
          );
        }
        return (
          <li key={entry.relativePath} className="min-w-0">
            <TreeLine depth={depth}>
              <FileLink
                target={{
                  kind: "workspace",
                  environmentId,
                  path: entry.relativePath,
                }}
                className={ITEM}
              >
                <FileGlyph token={fileIconToken(entry.relativePath)} />
                <span className="min-w-0 truncate">{entry.name}</span>
              </FileLink>
            </TreeLine>
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
            className={ITEM}
            title={entry.relativePath}
          >
            {entry.kind === "directory" ? (
              <FolderGlyph open={false} />
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
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const edges = useOverflowEdges(scroller, content);
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

  const onAutoOpen = useCallback((path: string) => {
    setExpanded((current) => {
      if (current.has(path)) return current;
      const next = new Set(current);
      next.add(path);
      return next;
    });
  }, []);

  if (error !== null && root === null) {
    return (
      <p role="alert" className="px-4 py-2.5 text-sm text-destructive">
        {error}
      </p>
    );
  }
  const filtering = filter.trim() !== "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 px-4 pt-0.5 pb-1.5">
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={scroller} className="h-full overflow-auto">
          <div ref={content}>
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
                onAutoOpen={onAutoOpen}
                cache={cache.current}
              />
            )}
          </div>
        </div>
        <ScrollEdgeFades
          above={edges.above}
          below={edges.below}
          color="var(--background)"
        />
      </div>
    </div>
  );
}

const HIDDEN = "data-sidetree-hide";
const ACTIONS = "data-sidetree-actions";
const STYLE_ID = "sidetree-host-chrome";
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
  const hideMenus = () => {
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      const label = item.textContent?.trim() ?? "";
      if (label === "Open externally") {
        markHidden(item);
      }
    }
    pinPreviewActionsRight();
  };
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `[${ACTIONS}]{margin-left:auto}
*:has(>input[role="combobox"][aria-label^="Search files"]:not([data-sidetree-search])),
*:has(>input[placeholder="No searchable source"]){display:none!important}`;
  document.head.appendChild(style);
  hideMenus();
  document.addEventListener("pointerdown", hideMenus, true);
  return () => {
    document.removeEventListener("pointerdown", hideMenus, true);
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
    title: "Open files",
    icon: "FolderOpen",
    layout: "flush",
    component: FilesPanel,
    run: ({ openPanel }) => {
      openPanel({ title: "Files" });
    },
  });
  app.slots.fileOpener({
    id: "file",
    title: "Editor",
    extensions: OPENER_EXTENSIONS,
    component: FileOpener,
  });
  app.slots.experimental_sourceCodeRenderer({
    id: "source",
    title: "Editor",
    description: "CodeMirror source preview",
    component: SourceRenderer,
  });
});
