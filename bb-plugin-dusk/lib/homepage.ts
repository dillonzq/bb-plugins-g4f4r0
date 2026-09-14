import { observeRoots } from "./observe-roots";
import type { Config } from "./config";
import { renderWallpaper } from "./wallpaper";
import { mountHomepageHeader } from "./homepage-header";

let current: Config | null = null;
const listeners = new Set<() => void>();
const slotListeners = new Set<() => void>();
let slots: HTMLElement[] = [];
export const getSlots = () => slots;
export function subscribeSlots(fn: () => void) { slotListeners.add(fn); return () => { slotListeners.delete(fn); }; }
function updateSlots(next: HTMLElement[]) { slots = next; slotListeners.forEach((fn) => fn()); }
export const getConfig = () => current;
export function subscribeConfig(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function setConfig(value: Config | null) {
  if (current === value || (current && value && current.image === value.image)) return;
  current = value; listeners.forEach((fn) => fn());
}

const homepageAnchorSelector = '[id="root-compose-prompt"], [role="img"][aria-label="bb"]';

function findHomepageShells() {
  const found = new Map<HTMLElement, HTMLElement>();
  document.querySelectorAll<HTMLElement>(homepageAnchorSelector).forEach((candidate) => {
    let anchor: HTMLElement | null = null;
    if (candidate.id === "root-compose-prompt") {
      anchor = candidate.closest<HTMLElement>("[data-promptbox-shell]");
    } else {
      const welcome = candidate.parentElement;
      const newThread = Array.from(welcome?.querySelectorAll<HTMLButtonElement>("button") ?? []).some((button) => {
        const label = button.textContent ?? "";
        return label.includes("New thread") && label.includes("Start a new conversation");
      });
      if (newThread) anchor = welcome;
    }

    const page = anchor?.closest<HTMLElement>('[class~="@container/page"]');
    const host = page?.parentElement;
    if (page && host?.classList.contains("overflow-hidden")) found.set(host, page);
  });
  return found;
}

// BB owns the welcome actions and composer DOM. Dusk only adds removable page
// artwork and its control around either native surface.
export function mountHomepage(signal: AbortSignal) {
  const attached = new Map<HTMLElement, { page: HTMLElement; dispose(): void; update(config: Config): void }>();
  if (signal.aborted) return () => {};
  const sync = () => {
    const found = new Set<HTMLElement>();
    findHomepageShells().forEach((page, host) => {
      found.add(host);
      const previous = attached.get(host);
      // The welcome launcher and New Thread composer swap inside the same page.
      // Keep the owned canvas alive so its ambient animation remains continuous.
      if (previous?.page === page) return;
      previous?.dispose();

      const canvas = document.createElement("canvas"); canvas.className = "dusk-wallpaper"; canvas.setAttribute("aria-hidden", "true");
      const shield = document.createElement("div"); shield.className = "dusk-shield"; shield.setAttribute("aria-hidden", "true");
      for (const element of [canvas, shield]) element.style.position = "absolute";
      for (const element of [canvas, shield]) { element.style.opacity = "0"; element.style.pointerEvents = "none"; }
      const classes: [HTMLElement, string][] = [[host, "dusk-home"], [page, "dusk-page"]];
      classes.forEach(([element, name]) => element.classList.add(name));
      host.prepend(canvas, shield);

      const control = document.createElement("div"); control.className = "dusk-background-header-action";
      const cutout = document.createElement("div"); cutout.className = "dusk-background-header-cutout"; cutout.setAttribute("aria-hidden", "true");
      host.append(control);
      const disposeHeader = mountHomepageHeader(host, control, cutout);
      updateSlots([...slots, control]);
      window.dispatchEvent(new Event("dusk:homepage-ready"));

      let styleFrame = 0;
      const adoptStyles = () => {
        styleFrame = 0;
        if (getComputedStyle(canvas).objectFit !== "cover") { styleFrame = requestAnimationFrame(adoptStyles); return; }
        for (const element of [canvas, shield]) element.style.removeProperty("opacity");
        paint();
      };
      let config = current, cancelPaint = () => {}, paintFrame = 0, paintTimer = 0, crossfade = false;
      const paint = () => {
        cancelAnimationFrame(paintFrame);
        paintFrame = requestAnimationFrame(() => {
          clearTimeout(paintTimer);
          if (config) {
            const next = config, fade = crossfade; crossfade = false;
            paintTimer = window.setTimeout(() => {
              cancelPaint(); cancelPaint = renderWallpaper(canvas, next, fade);
            }, canvas.hasAttribute("data-ready") && !fade ? 100 : 0);
          }
        });
      };
      const resize = new ResizeObserver(() => {
        // The photo renderer handles resizing without recreating its texture.
        // Only the procedural field needs a new renderer at this resolution.
        if (!config?.image) paint();
      });
      resize.observe(host);
      adoptStyles();
      attached.set(host, {
        page,
        update(next) {
          if (config && canvas.hasAttribute("data-ready") && next.image !== config.image) crossfade = true;
          config = next; paint();
        },
        dispose() {
          resize.disconnect(); disposeHeader();
          updateSlots(slots.filter((slot) => slot !== control)); control.remove(); cutout.remove();
          cancelAnimationFrame(paintFrame); cancelAnimationFrame(styleFrame); clearTimeout(paintTimer); cancelPaint(); canvas.remove(); shield.remove();
          classes.forEach(([element, name]) => element.classList.remove(name));
        },
      });
    });
    attached.forEach((entry, host) => { if (!found.has(host)) { entry.dispose(); attached.delete(host); } });
  };
  const schedule = () => { if (!signal.aborted) sync(); };
  const stopObserving = observeRoots(homepageAnchorSelector, schedule, false);
  const changed = () => { sync(); if (current) attached.forEach((entry) => entry.update(current!)); };
  const themeObserver = new MutationObserver(changed);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-palette"] });
  listeners.add(changed); schedule();
  const dispose = () => { stopObserving(); themeObserver.disconnect(); listeners.delete(changed); attached.forEach((entry) => entry.dispose()); attached.clear(); };
  signal.addEventListener("abort", dispose, { once: true });
  return () => { signal.removeEventListener("abort", dispose); dispose(); };
}
