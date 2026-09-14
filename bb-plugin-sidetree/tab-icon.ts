import { fileIconSrc } from "./file-icon";
import { fileIconToken, fileName } from "./tree";

const MARK = "data-sidetree-tab-icon";

function matchingTab(name: string): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const node of document.querySelectorAll('[role="tab"]')) {
    if (!(node instanceof HTMLElement)) continue;
    const label = node.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    if (label !== name && !label.startsWith(name)) continue;
    if (node.getAttribute("aria-selected") === "true") return node;
    fallback ??= node;
  }
  return fallback;
}

function paint(tab: HTMLElement, src: string): HTMLElement | null {
  const current = tab.querySelector<HTMLElement>("svg, img");
  if (current === null) return null;
  if (current.tagName === "IMG" && current.hasAttribute(MARK)) {
    (current as HTMLImageElement).src = src;
    return current;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.src = src;
  img.setAttribute(MARK, "");
  img.className = current.className;
  img.style.width = current.style.width || "16px";
  img.style.height = current.style.height || "16px";
  img.style.flexShrink = "0";
  current.replaceWith(img);
  return current;
}

/** Host tabs use the plugin FolderOpen glyph. Swap in this file's icon. */
export function syncFileTabIcon(path: string): () => void {
  const name = fileName(path);
  const src = fileIconSrc(fileIconToken(path));
  let tab: HTMLElement | null = null;
  let original: HTMLElement | null = null;
  let observer: MutationObserver | null = null;

  const apply = () => {
    const next = matchingTab(name);
    if (next === null) return;
    if (tab !== next) {
      observer?.disconnect();
      if (tab !== null && original !== null) {
        tab.querySelector(`[${MARK}]`)?.replaceWith(original);
      }
      tab = next;
      original = paint(next, src);
      observer = new MutationObserver(() => {
        if (tab === null || tab.querySelector(`[${MARK}]`) !== null) return;
        original = paint(tab, src);
      });
      observer.observe(next, { childList: true, subtree: true });
      return;
    }
    paint(next, src);
  };

  apply();
  const frame = window.requestAnimationFrame(apply);
  return () => {
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
    if (tab !== null && original !== null) {
      tab.querySelector(`[${MARK}]`)?.replaceWith(original);
    }
  };
}
