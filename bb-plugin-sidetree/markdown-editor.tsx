import { memo, useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from "react";
import { experimental_useCodeTheme, useComposer } from "@get-bb/plugin-sdk/app";
import type { CodeEditorHandle } from "./code-editor";
import { Editor } from "./components/ui/editor/editor";
import { editorSelectionPaint } from "./editor-theme";
import { quoteSelectedText } from "./quote-selection";
import "./markdown-editor.css";

export const MarkdownEditor = memo(function MarkdownEditor({
  path,
  value,
  saved,
  onDirty,
  readOnly,
  editorRef,
}: {
  path: string;
  value: string;
  saved: string;
  onDirty?: (dirty: boolean) => void;
  readOnly: boolean;
  editorRef?: Ref<CodeEditorHandle | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const live = useRef(value);
  const savedRef = useRef(saved);
  const onDirtyRef = useRef(onDirty);
  const composer = useComposer();
  const paint = editorSelectionPaint(experimental_useCodeTheme().theme);
  savedRef.current = saved;
  onDirtyRef.current = onDirty;

  useEffect(() => {
    live.current = value;
  }, [value]);

  useImperativeHandle(editorRef, () => ({
    getDoc() {
      return live.current;
    },
    blur() {
      const node = root.current?.querySelector<HTMLElement>(".ProseMirror");
      node?.blur();
    },
  }));

  return (
    <div
      ref={root}
      className="sidetree-md h-full min-h-0 overflow-auto"
      style={
        {
          "--sidetree-sel-bg": paint.background,
          "--sidetree-sel-fg": paint.color,
        } as CSSProperties
      }
    >
      <Editor
        value={value}
        format="markdown"
        disabled={readOnly}
        enableImages
        enableImagePasteDrop={false}
        className="h-full min-h-0"
        onAddToChat={(markdown) => {
          const text = quoteSelectedText(path, live.current, markdown);
          if (text !== null) composer.addQuote(text);
        }}
        onChange={(next) => {
          live.current = next;
          onDirtyRef.current?.(next !== savedRef.current);
        }}
      />
    </div>
  );
});
