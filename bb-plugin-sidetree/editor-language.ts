import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { css, less, sCSS } from "@codemirror/legacy-modes/mode/css";
import {
  c,
  cpp,
  csharp,
  dart,
  java,
  kotlin,
  objectiveC,
  objectiveCpp,
} from "@codemirror/legacy-modes/mode/clike";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { go } from "@codemirror/legacy-modes/mode/go";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { python } from "@codemirror/legacy-modes/mode/python";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml, html } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { languageIdForPath } from "./tree";

function stream(
  parser: Parameters<typeof StreamLanguage.define>[0],
): Extension {
  return StreamLanguage.define(parser);
}

const BY_EXT: Record<string, () => Extension> = {
  astro: () => stream(html),
  bash: () => stream(shell),
  bib: () => stream(stex),
  c: () => stream(c),
  cc: () => stream(cpp),
  cfg: () => stream(properties),
  cjs: () => javascript(),
  clj: () => stream(clojure),
  cljs: () => stream(clojure),
  cmake: () => stream(cmake),
  conf: () => stream(properties),
  cpp: () => stream(cpp),
  cs: () => stream(csharp),
  css: () => stream(css),
  cts: () => javascript({ typescript: true }),
  cxx: () => stream(cpp),
  dart: () => stream(dart),
  diff: () => stream(diff),
  dockerfile: () => stream(dockerFile),
  edn: () => stream(clojure),
  erl: () => stream(erlang),
  go: () => stream(go),
  h: () => stream(c),
  hpp: () => stream(cpp),
  hrl: () => stream(erlang),
  hs: () => stream(haskell),
  htm: () => stream(html),
  html: () => stream(html),
  ini: () => stream(properties),
  java: () => stream(java),
  js: () => javascript(),
  json: () => json(),
  jsonc: () => json(),
  jsx: () => javascript({ jsx: true }),
  kt: () => stream(kotlin),
  kts: () => stream(kotlin),
  less: () => stream(less),
  lua: () => stream(lua),
  m: () => stream(objectiveC),
  makefile: () => stream(shell),
  markdown: () => markdown(),
  md: () => markdown(),
  mdx: () => markdown(),
  mjs: () => javascript(),
  mk: () => stream(shell),
  ml: () => stream(oCaml),
  mli: () => stream(oCaml),
  mm: () => stream(objectiveCpp),
  mts: () => javascript({ typescript: true }),
  php: () => stream(html),
  pl: () => stream(perl),
  pm: () => stream(perl),
  properties: () => stream(properties),
  proto: () => stream(protobuf),
  py: () => stream(python),
  pyi: () => stream(python),
  rb: () => stream(ruby),
  rs: () => stream(rust),
  scss: () => stream(sCSS),
  sh: () => stream(shell),
  sql: () => stream(standardSQL),
  svelte: () => stream(html),
  svg: () => stream(xml),
  swift: () => stream(swift),
  tex: () => stream(stex),
  toml: () => stream(toml),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  vue: () => stream(html),
  xml: () => stream(xml),
  yaml: () => stream(yaml),
  yml: () => stream(yaml),
  zsh: () => stream(shell),
};

const cache = new Map<string, Extension[]>();

export function languageForPath(path: string): Extension[] {
  const id = languageIdForPath(path);
  if (id === null) return [];
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const factory = BY_EXT[id];
  const next = factory === undefined ? [] : [factory()];
  cache.set(id, next);
  return next;
}
