import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { EditorState, Prec, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import { languageForPath } from "./editor-language";
import { codeMirrorTheme } from "./editor-theme";

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly,
  lineRange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  readOnly: boolean;
  lineRange?: { startLineNumber: number; endLineNumber: number } | null;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const codeTheme = experimental_useCodeTheme();

  useEffect(() => {
    const node = parent.current;
    if (node === null) return;
    const view = new EditorView({
      parent: node,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  onSaveRef.current();
                  return true;
                },
              },
            ]),
          ),
          language.current.of(languageForPath(path)),
          theme.current.of(
            codeTheme.theme !== null ? codeMirrorTheme(codeTheme.theme) : [],
          ),
          editable.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate when the file identity changes. Theme/readOnly reconfigure below.
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: language.current.reconfigure(languageForPath(path)),
    });
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || codeTheme.theme === null) return;
    view.dispatch({
      effects: theme.current.reconfigure(codeMirrorTheme(codeTheme.theme)),
    });
  }, [codeTheme.theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || lineRange == null) return;
    const doc = view.state.doc;
    const startLine = Math.min(Math.max(lineRange.startLineNumber, 1), doc.lines);
    const endLine = Math.min(Math.max(lineRange.endLineNumber, startLine), doc.lines);
    const start = doc.line(startLine);
    const end = doc.line(endLine);
    view.dispatch({
      selection: { anchor: start.from, head: end.to },
      scrollIntoView: true,
    });
    view.focus();
  }, [lineRange]);

  return <div ref={parent} className="h-full min-h-0" />;
}
