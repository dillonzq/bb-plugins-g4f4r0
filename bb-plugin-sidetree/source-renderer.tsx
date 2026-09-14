import { useLayoutEffect, useRef } from "react";
import type { PluginSourceCodeRendererProps } from "@get-bb/plugin-sdk/app";
import { CodeEditor } from "./code-editor";

/** BB's FileLink opens this preview, not Sidetree's ⋮ opener. */
export function SourceRenderer({
  content,
  path,
  overflow,
  highlightedLines,
}: PluginSourceCodeRendererProps) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (parent == null) return;
    const position = parent.style.position;
    const overflowStyle = parent.style.overflow;
    parent.style.position = "relative";
    parent.style.overflow = "hidden";
    return () => {
      parent.style.position = position;
      parent.style.overflow = overflowStyle;
    };
  }, []);

  return (
    <div ref={root} className="absolute inset-0 min-h-0 overflow-hidden">
      <CodeEditor
        path={path}
        value={content}
        readOnly
        wrap={overflow === "wrap"}
        startLine={highlightedLines?.start}
        endLine={highlightedLines?.end}
      />
    </div>
  );
}
