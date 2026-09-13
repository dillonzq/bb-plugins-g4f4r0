// Wallpaper changes dissolve over the same duration as the layer fade-in.
const FADE_MS = 240;

export function snapshot(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (!canvas.hasAttribute("data-ready") || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const copy = document.createElement("canvas");
  copy.width = canvas.width; copy.height = canvas.height;
  copy.getContext("2d")?.drawImage(canvas, 0, 0);
  return copy;
}

export function drawFade(context: CanvasRenderingContext2D, from: HTMLCanvasElement, started: number, now = performance.now()) {
  const remaining = 1 - (now - started) / FADE_MS;
  if (remaining <= 0) return false;
  context.globalAlpha = remaining * remaining * (3 - 2 * remaining);
  context.drawImage(from, 0, 0, context.canvas.width, context.canvas.height);
  context.globalAlpha = 1;
  return true;
}
