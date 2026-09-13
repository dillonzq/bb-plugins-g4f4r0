import { cn } from "./lib/utils";

const COLOR: Record<string, string> = {
  bash: "#3f9c35",
  css: "#563d7c",
  default: "var(--muted-foreground)",
  docker: "#2496ed",
  eslint: "#4b32c3",
  git: "#f05133",
  go: "#00add8",
  html: "#e34f26",
  image: "#c44e9b",
  javascript: "#c4a000",
  json: "#cb8a2a",
  markdown: "#4a8f4a",
  prettier: "#1a2b34",
  python: "#3776ab",
  ruby: "#cc342d",
  rust: "#dea584",
  text: "var(--muted-foreground)",
  typescript: "#3178c6",
  yml: "#cb171e",
};

function FileShape() {
  return (
    <>
      <path
        fill="currentColor"
        opacity=".5"
        d="M8 1v3a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1z"
      />
      <path
        fill="currentColor"
        d="M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z"
      />
    </>
  );
}

export function FileGlyph({
  token,
  className,
}: {
  token: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0", className)}
      style={{ color: COLOR[token] ?? COLOR.default }}
    >
      <FileShape />
    </svg>
  );
}
