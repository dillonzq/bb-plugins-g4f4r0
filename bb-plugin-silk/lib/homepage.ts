import { observeRoots } from "./observe-roots";
import type { Config } from "./config";
import { renderWallpaper } from "./wallpaper";

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

// BB owns the welcome actions and composer DOM. Silk only adds removable page
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

      const canvas = document.createElement("canvas"); canvas.className = "silk-wallpaper"; canvas.setAttribute("aria-hidden", "true");
      const shield = document.createElement("div"); shield.className = "silk-shield"; shield.setAttribute("aria-hidden", "true");
      for (const element of [canvas, shield]) element.style.position = "absolute";
      for (const element of [canvas, shield]) { element.style.opacity = "0"; element.style.pointerEvents = "none"; }
      const classes: [HTMLElement, string][] = [[host, "silk-home"], [page, "silk-page"]];
      classes.forEach(([element, name]) => element.classList.add(name));
      host.prepend(canvas, shield);

      const control = document.createElement("div"); control.className = "silk-background-header-action";
      const cutout = document.createElement("div"); cutout.className = "silk-background-header-cutout"; cutout.setAttribute("aria-hidden", "true");
      let observedTrigger: HTMLElement | null = null;
      let positionControl: (expanded?: boolean) => void = () => {};
      const onSidebarToggle = () => positionControl(observedTrigger?.getAttribute("aria-expanded") !== "true");
      const sidebarObserver = new MutationObserver(() => positionControl());
      const observeTrigger = (trigger: HTMLElement | null) => {
        if (trigger === observedTrigger) return;
        observedTrigger?.removeEventListener("click", onSidebarToggle, true);
        sidebarObserver.disconnect();
        observedTrigger = trigger;
        if (trigger) {
          trigger.addEventListener("click", onSidebarToggle, true);
          sidebarObserver.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
        }
      };
      positionControl = (expanded) => {
        const strip = host.querySelector('[data-testid="root-compose-main-window-drag-strip"]');
        if (strip && cutout.parentElement !== strip) strip.append(cutout);
        if (!strip) cutout.remove();
        const bounds = host.getBoundingClientRect();
        const triggerElement = document.querySelector<HTMLElement>('[data-testid="app-desktop-sidebar-trigger"] [data-sidebar="trigger"], [data-testid="app-sidebar-trigger-overlay"] [data-sidebar="trigger"]');
        observeTrigger(triggerElement);
        const trigger = triggerElement?.getBoundingClientRect();
        const sidebarOpen = expanded ?? triggerElement?.getAttribute("aria-expanded") === "true";
        // The native desktop toggle includes the window-control inset. With
        // the sidebar open, the homepage has its own left edge; when closed,
        // convert the toggle's viewport coordinates into homepage coordinates.
        const x = trigger && !sidebarOpen ? Math.max(12, trigger.right + 4 - bounds.left) : 12;
        const left = `${Math.round(x * 100) / 100}px`;
        const top = trigger ? `${Math.max(0, trigger.top - bounds.top)}px` : "10px";
        control.style.top = top; cutout.style.top = top;
        control.style.setProperty("--silk-header-x", left);
        cutout.style.setProperty("--silk-header-x", left);
      };
      host.append(control);
      positionControl();
      updateSlots([...slots, control]);
      window.dispatchEvent(new Event("silk:homepage-ready"));

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
          positionControl();
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
        positionControl();
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
          resize.disconnect(); observedTrigger?.removeEventListener("click", onSidebarToggle, true); sidebarObserver.disconnect();
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
