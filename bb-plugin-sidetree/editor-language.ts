import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sass } from "@codemirror/lang-sass";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { vue } from "@codemirror/lang-vue";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import {
  csharp,
  dart,
  kotlin,
  objectiveC,
  objectiveCpp,
} from "@codemirror/legacy-modes/mode/clike";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { languageIdForPath } from "./tree";

function stream(
  parser: Parameters<typeof StreamLanguage.define>[0],
): Extension {
  return StreamLanguage.define(parser);
}

const BY_EXT: Record<string, () => Extension> = {
  astro: () => html(),
  bash: () => stream(shell),
  bib: () => stream(stex),
  c: () => cpp(),
  cc: () => cpp(),
  cfg: () => stream(properties),
  cjs: () => javascript(),
  clj: () => stream(clojure),
  cljs: () => stream(clojure),
  cmake: () => stream(cmake),
  conf: () => stream(properties),
  cpp: () => cpp(),
  cs: () => stream(csharp),
  css: () => css(),
  cts: () => javascript({ typescript: true }),
  cxx: () => cpp(),
  dart: () => stream(dart),
  diff: () => stream(diff),
  dockerfile: () => stream(dockerFile),
  edn: () => stream(clojure),
  erl: () => stream(erlang),
  go: () => go(),
  h: () => cpp(),
  hpp: () => cpp(),
  hrl: () => stream(erlang),
  hs: () => stream(haskell),
  htm: () => html(),
  html: () => html(),
  ini: () => stream(properties),
  java: () => java(),
  js: () => javascript(),
  json: () => json(),
  jsonc: () => json(),
  jsx: () => javascript({ jsx: true }),
  kt: () => stream(kotlin),
  kts: () => stream(kotlin),
  less: () => css(),
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
  php: () => php(),
  pl: () => stream(perl),
  pm: () => stream(perl),
  properties: () => stream(properties),
  proto: () => stream(protobuf),
  py: () => python(),
  pyi: () => python(),
  rb: () => stream(ruby),
  rs: () => rust(),
  scss: () => sass(),
  sh: () => stream(shell),
  sql: () => sql(),
  svelte: () => html(),
  svg: () => xml(),
  swift: () => stream(swift),
  tex: () => stream(stex),
  toml: () => stream(toml),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  vue: () => vue(),
  xml: () => xml(),
  yaml: () => yaml(),
  yml: () => yaml(),
  zsh: () => stream(shell),
};

export function languageForPath(path: string): Extension[] {
  const id = languageIdForPath(path);
  if (id === null) return [];
  const factory = BY_EXT[id];
  return factory === undefined ? [] : [factory()];
}
