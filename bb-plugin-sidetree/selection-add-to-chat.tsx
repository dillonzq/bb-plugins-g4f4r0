import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import type { EditorView } from "@codemirror/view";
import {
  experimental_Icon as Icon,
  useComposer,
} from "@get-bb/plugin-sdk/app";
import { usePointerCoarse } from "./components/ui/hooks/use-pointer-coarse";
import { preventOverlayTriggerSelection } from "./components/ui/overlay-trigger";
import { usePortalScopeProps } from "./lib/portal-scope";
import {
  lineRangeForDoc,
  quotePathLines,
} from "./quote-selection";

const DRAG_SIDE_PX = 4;

const ACTION =
  "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none max-md:pointer-coarse:min-h-7 max-md:pointer-coarse:px-2 max-md:pointer-coarse:py-1";

const MENU =
  "z-50 flex w-auto items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

type AnchorSide = "top" | "bottom";

type Selection = {
  text: string;
  rect: DOMRect;
  anchorPoint?: { x: number; y: number };
  anchorSide?: AnchorSide;
};

function isInside(event: Event, node: HTMLElement | null): boolean {
  if (node === null || !(event.target instanceof Node)) return false;
  return node.contains(event.target);
}

function pointFromMouse(
  event: Pick<MouseEvent, "clientX" | "clientY">,
): { x: number; y: number } | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

function livePointer(pointerType: string | undefined): boolean {
  return pointerType !== undefined && pointerType !== "" && pointerType !== "mouse";
}

function anchorFromRelease(
  start: { x: number; y: number } | null,
  event: Pick<MouseEvent, "clientX" | "clientY"> & { pointerType?: string },
): { point: { x: number; y: number }; side: AnchorSide } | null {
  if (livePointer(event.pointerType)) return null;
  const point = pointFromMouse(event);
  if (point === null) return null;
  return {
    point,
    side:
      start !== null && point.y - start.y > DRAG_SIDE_PX ? "bottom" : "top",
  };
}

function selectionRect(view: EditorView, from: number, to: number): DOMRect | null {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  if (start === null && end === null) return null;
  const a = start ?? end;
  const b = end ?? start;
  if (a === null || b === null) return null;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(
    left,
    top,
    Math.max(a.right, b.right) - left,
    Math.max(a.bottom, b.bottom) - top,
  );
}

function readEditorSelection({
  view,
  path,
  anchor,
}: {
  view: EditorView | null;
  path: string;
  anchor: { point: { x: number; y: number }; side: AnchorSide } | null;
}): Selection | null {
  if (view === null) return null;
  const range = view.state.selection.main;
  if (range.empty) return null;
  const doc = view.state.doc;
  const lines = lineRangeForDoc(doc, range.from, range.to);
  if (lines === null) return null;
  const text = quotePathLines(
    path,
    lines.start,
    lines.end,
    doc.sliceString(doc.line(lines.start).from, doc.line(lines.end).to),
  );
  if (text === null) return null;
  const rect =
    selectionRect(view, range.from, range.to) ??
    (anchor === null
      ? view.dom.getBoundingClientRect()
      : new DOMRect(anchor.point.x, anchor.point.y, 0, 0));
  const next: Selection = { text, rect };
  if (anchor !== null) {
    next.anchorPoint = anchor.point;
    next.anchorSide = anchor.side;
  }
  return next;
}

function AddToChatButton({
  selection,
  onSelect,
  onDismiss,
}: {
  selection: Selection;
  onSelect: (text: string) => void;
  onDismiss: () => void;
}) {
  const skipClick = useRef(false);
  const activate = () => {
    flushSync(() => {
      onSelect(selection.text);
      onDismiss();
    });
  };
  return (
    <button
      type="button"
      className={ACTION}
      onMouseDown={preventOverlayTriggerSelection}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse") return;
        event.preventDefault();
        skipClick.current = true;
      }}
      onPointerUp={(event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse" || !skipClick.current) return;
        activate();
      }}
      onPointerCancel={() => {
        skipClick.current = false;
      }}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        activate();
      }}
    >
      <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
      Add to chat
    </button>
  );
}

function SelectionMenu({
  selection,
  onSelect,
  onDismiss,
}: {
  selection: Selection | null;
  onSelect: (text: string) => void;
  onDismiss: () => void;
}) {
  const portal = usePortalScopeProps();
  const open = selection !== null;
  const side = selection?.anchorSide ?? "top";
  const left =
    selection?.anchorPoint?.x ??
    (selection === null ? 0 : selection.rect.left + selection.rect.width / 2);
  const top =
    selection?.anchorPoint?.y ??
    (selection === null
      ? 0
      : side === "bottom"
        ? selection.rect.bottom
        : selection.rect.top);
  const virtual = useMemo(
    () => ({
      getBoundingClientRect: () => new DOMRect(left, top, 0, 0),
    }),
    [left, top],
  );
  const virtualRef = useRef(virtual);
  virtualRef.current = virtual;

  useEffect(() => {
    if (!open) return;
    const dismiss = () => onDismiss();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, onDismiss]);

  if (selection === null) return null;

  return (
    <Popover.Root
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          {...portal}
          side={side}
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className={MENU}
          onEscapeKeyDown={() => onDismiss()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <AddToChatButton
            selection={selection}
            onSelect={onSelect}
            onDismiss={onDismiss}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function useSelectionAddToChat({
  containerRef,
  viewRef,
  path,
  skipRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
  viewRef: RefObject<EditorView | null>;
  path: string;
  skipRef: MutableRefObject<boolean>;
}): { menu: ReactNode } {
  const composer = useComposer();
  const coarse = usePointerCoarse();
  const enabled = !coarse;
  const [selection, setSelection] = useState<Selection | null>(null);
  const startedInside = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const pointerDown = useRef(false);
  const lastAnchor = useRef<{
    point: { x: number; y: number };
    side: AnchorSide;
  } | null>(null);

  const dismiss = useCallback(() => {
    setSelection(null);
  }, []);

  const report = useCallback(
    (anchor: { point: { x: number; y: number }; side: AnchorSide } | null) => {
      if (skipRef.current) {
        setSelection(null);
        return;
      }
      setSelection(
        readEditorSelection({
          view: viewRef.current,
          path,
          anchor,
        }),
      );
    },
    [path, skipRef, viewRef],
  );

  useEffect(() => {
    setSelection(null);
  }, [path]);

  useEffect(() => {
    if (!enabled) return;

    let frame: number | null = null;
    const cancel = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const schedule = (
      anchor: { point: { x: number; y: number }; side: AnchorSide } | null,
    ) => {
      cancel();
      frame = window.requestAnimationFrame(() => {
        frame = null;
        report(anchor);
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      cancel();
      startedInside.current = isInside(event, containerRef.current);
      startPoint.current = startedInside.current
        ? pointFromMouse(event)
        : null;
      pointerDown.current = true;
      if (startedInside.current) skipRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const view = viewRef.current;
      if (view === null || !view.hasFocus) return;
      const selectAll =
        event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey);
      if (event.shiftKey || selectAll) skipRef.current = false;
    };
    const onRelease = (event: PointerEvent | MouseEvent) => {
      const started = startedInside.current;
      const anchor =
        started && startPoint.current !== null
          ? anchorFromRelease(startPoint.current, event)
          : null;
      if (anchor !== null) lastAnchor.current = anchor;
      pointerDown.current = false;
      startPoint.current = null;
      if (!started) return;
      schedule(anchor ?? lastAnchor.current);
    };
    const onCancel = () => {
      pointerDown.current = false;
      startPoint.current = null;
    };
    const onSelectionChange = () => {
      if (pointerDown.current) return;
      const view = viewRef.current;
      if (view === null || !view.hasFocus) return;
      schedule(lastAnchor.current);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onRelease);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("mouseup", onRelease);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onSelectionChange);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onRelease);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("mouseup", onRelease);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onSelectionChange);
    };
  }, [containerRef, enabled, report, skipRef, viewRef]);

  const addToChat = useCallback(
    (text: string) => {
      composer.addQuote(text);
      const view = viewRef.current;
      if (view !== null) {
        const head = view.state.selection.main.head;
        view.dispatch({ selection: { anchor: head } });
      }
      setSelection(null);
    },
    [composer, viewRef],
  );

  return {
    menu: enabled ? (
      <SelectionMenu
        selection={selection}
        onSelect={addToChat}
        onDismiss={dismiss}
      />
    ) : null,
  };
}
