import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t, type Tag } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";

const SCOPE_TAGS: readonly { scope: string; tag: Tag | readonly Tag[] }[] = [
  { scope: "comment.line", tag: t.lineComment },
  { scope: "comment.block", tag: t.blockComment },
  { scope: "comment", tag: t.comment },
  { scope: "string.regexp", tag: t.regexp },
  { scope: "string", tag: t.string },
  { scope: "constant.numeric", tag: t.number },
  { scope: "constant.language.boolean", tag: t.bool },
  { scope: "constant.character.escape", tag: t.escape },
  { scope: "constant.language", tag: t.atom },
  { scope: "constant", tag: t.atom },
  { scope: "variable.parameter", tag: t.variableName },
  { scope: "variable.language", tag: t.self },
  { scope: "variable.function", tag: t.function(t.variableName) },
  { scope: "variable", tag: t.variableName },
  { scope: "keyword.control", tag: t.controlKeyword },
  { scope: "keyword.operator", tag: t.operatorKeyword },
  { scope: "keyword", tag: t.keyword },
  { scope: "storage.type", tag: t.definitionKeyword },
  { scope: "storage.modifier", tag: t.modifier },
  { scope: "storage", tag: t.keyword },
  { scope: "entity.name.function", tag: t.function(t.name) },
  { scope: "entity.name.class", tag: t.className },
  { scope: "entity.name.type", tag: t.typeName },
  { scope: "entity.name.tag", tag: t.tagName },
  { scope: "entity.other.attribute-name", tag: t.attributeName },
  { scope: "entity.name", tag: t.name },
  { scope: "support.function", tag: t.standard(t.function(t.variableName)) },
  { scope: "support.class", tag: t.standard(t.className) },
  { scope: "support.type", tag: t.standard(t.typeName) },
  { scope: "punctuation", tag: t.punctuation },
  { scope: "markup.heading", tag: t.heading },
  { scope: "markup.bold", tag: t.strong },
  { scope: "markup.italic", tag: t.emphasis },
  { scope: "markup.strikethrough", tag: t.strikethrough },
  { scope: "markup.quote", tag: t.quote },
  { scope: "markup.underline.link", tag: t.link },
  { scope: "markup.inline.raw", tag: t.monospace },
  { scope: "markup.inserted", tag: t.inserted },
  { scope: "markup.deleted", tag: t.deleted },
  { scope: "markup.changed", tag: t.changed },
  { scope: "invalid", tag: t.invalid },
];

export function tagForScope(scope: string): Tag | readonly Tag[] | null {
  let best: { scope: string; tag: Tag | readonly Tag[] } | null = null;
  for (const entry of SCOPE_TAGS) {
    if (scope === entry.scope || scope.startsWith(`${entry.scope}.`)) {
      if (best === null || entry.scope.length > best.scope.length) best = entry;
    }
  }
  return best?.tag ?? null;
}

function workbench(
  colors: Readonly<Record<string, string>>,
  key: string,
  fallback: string,
): string {
  return colors[key] ?? fallback;
}

export function codeMirrorTheme(theme: PluginCodeThemeData): Extension {
  const bg = workbench(theme.colors, "editor.background", theme.bg);
  const fg = workbench(theme.colors, "editor.foreground", theme.fg);
  const cursor = workbench(theme.colors, "editorCursor.foreground", fg);
  const selection = workbench(
    theme.colors,
    "editor.selectionBackground",
    theme.type === "dark" ? "#264f78" : "#add6ff",
  );
  const line = workbench(theme.colors, "editor.lineHighlightBackground", "transparent");
  const gutterBg = workbench(theme.colors, "editorGutter.background", bg);
  const gutterFg = workbench(theme.colors, "editorLineNumber.foreground", fg);
  const gutterActive = workbench(
    theme.colors,
    "editorLineNumber.activeForeground",
    fg,
  );
  const match = workbench(theme.colors, "editor.findMatchBackground", selection);
  const widget = workbench(theme.colors, "editorWidget.background", bg);
  const widgetBorder = workbench(theme.colors, "editorWidget.border", fg);

  const highlight: { tag: Tag | readonly Tag[]; color?: string; fontStyle?: string; textDecoration?: string }[] =
    [];
  for (const rule of theme.tokenColors) {
    const scopes =
      rule.scope === undefined
        ? []
        : typeof rule.scope === "string"
          ? [rule.scope]
          : [...rule.scope];
    for (const scope of scopes) {
      const tag = tagForScope(scope);
      if (tag === null) continue;
      const font = rule.settings.fontStyle ?? "";
      highlight.push({
        tag,
        color: rule.settings.foreground,
        fontStyle: font.includes("italic") ? "italic" : undefined,
        textDecoration: font.includes("underline")
          ? "underline"
          : font.includes("strikethrough")
            ? "line-through"
            : undefined,
      });
    }
  }

  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          backgroundColor: bg,
          color: fg,
        },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: "13px",
          lineHeight: "1.5",
        },
        ".cm-content": { caretColor: cursor, fontFamily: "inherit", fontSize: "inherit" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: cursor },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
          { backgroundColor: selection },
        ".cm-activeLine": { backgroundColor: line },
        ".cm-gutters": {
          backgroundColor: gutterBg,
          color: gutterFg,
          border: "none",
          fontFamily: "inherit",
          fontSize: "inherit",
        },
        ".cm-activeLineGutter": {
          backgroundColor: line,
          color: gutterActive,
        },
        ".cm-selectionMatch": { backgroundColor: match },
        ".cm-panels": { backgroundColor: widget, color: fg },
        ".cm-panels .cm-panel": { borderTop: `1px solid ${widgetBorder}` },
        ".cm-searchMatch": { backgroundColor: match },
      },
      { dark: theme.type === "dark" },
    ),
    syntaxHighlighting(HighlightStyle.define(highlight)),
  ];
}
