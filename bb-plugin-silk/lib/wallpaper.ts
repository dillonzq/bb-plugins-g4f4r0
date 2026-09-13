import type { Config } from "./config";
import { animateAmbient } from "./ambient";
import { drawFade, snapshot } from "./fade";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let decoded: { src: string; image: Promise<HTMLImageElement> } | null = null;

function decode(src: string) {
  if (decoded?.src !== src) {
    const image = new Image();
    image.src = src;
    decoded = { src, image: image.decode().then(() => image) };
    decoded.image.catch(() => { if (decoded?.src === src) decoded = null; });
  }
  return decoded.image;
}

export function renderWallpaper(canvas: HTMLCanvasElement, config: Config, crossfade = false): () => void {
  let cancelled = false, fadeFrame = 0;
  const from = crossfade ? snapshot(canvas) : null;
  const target = config.image ? document.createElement("canvas") : canvas;
  const cssWidth = Math.max(1, canvas.clientWidth), cssHeight = Math.max(1, canvas.clientHeight);
  const resolution = Math.min(config.image ? 1 : 0.5, 2400 / cssWidth, 1800 / cssHeight);
  const w = Math.max(1, Math.round(cssWidth * resolution));
  const h = Math.max(1, Math.round(cssHeight * resolution));
  const dark = document.documentElement.classList.contains("dark");
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.fillStyle = getComputedStyle(canvas).getPropertyValue("--background").trim() || (dark ? "#141414" : "#ffffff");
  probe.fillRect(0, 0, 1, 1);
  const base = Array.from(probe.getImageData(0, 0, 1, 1).data);
  if (!config.image) {
    target.width = w; target.height = h;
    const dispose = animateAmbient(canvas, base, dark, from);
    canvas.dataset.ready = "";
    return dispose;
  }
  decode(config.image).then((image) => {
    if (cancelled) return;
    target.width = w; target.height = h;
    const context = target.getContext("2d", { willReadFrequently: true })!;
    const scale = Math.max(w / image.width, h / image.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (w - image.width * scale) / 2, (h - image.height * scale) / 2, image.width * scale, image.height * scale);
    const pixels = context.getImageData(0, 0, w, h), data = pixels.data;
    const cellsX = new Uint8Array(w), cellsY = new Uint8Array(h);
    for (let x = 0; x < w; x++) cellsX[x] = Math.floor(x / w * cssWidth / 2) % 4;
    for (let y = 0; y < h; y++) cellsY[y] = Math.floor(y / h * cssHeight / 2) % 4;
    const g0 = dark ? 0 : base[0], g1 = dark ? 0 : base[1], g2 = dark ? 0 : base[2];
    for (let y = 0, index = 0; y < h; y++) {
      const row = cellsY[y] * 4;
      for (let x = 0; x < w; x++, index += 4) {
        const threshold = (BAYER[row + cellsX[x]] + 0.5) / 16;
        const luminance = (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
        const opacity = threshold < 0.18 + luminance * 0.64 ? 0.84 : 0.2688;
        data[index] = g0 + (data[index] - g0) * opacity;
        data[index + 1] = g1 + (data[index + 1] - g1) * opacity;
        data[index + 2] = g2 + (data[index + 2] - g2) * opacity;
        data[index + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    canvas.width = w; canvas.height = h;
    const visible = canvas.getContext("2d")!;
    visible.drawImage(target, 0, 0);
    canvas.dataset.ready = "";
    if (!from) return;
    const started = performance.now();
    drawFade(visible, from, started, started);
    const step = (now: number) => {
      if (cancelled) return;
      visible.drawImage(target, 0, 0);
      fadeFrame = drawFade(visible, from, started, now) ? requestAnimationFrame(step) : 0;
    };
    fadeFrame = requestAnimationFrame(step);
  }, () => {
    if (cancelled || canvas.hasAttribute("data-ready")) return;
    canvas.width = w; canvas.height = h;
    const visible = canvas.getContext("2d");
    if (visible) { visible.fillStyle = `rgb(${base.slice(0, 3).join(",")})`; visible.fillRect(0, 0, w, h); }
  });
  return () => { cancelled = true; cancelAnimationFrame(fadeFrame); };
}

export async function prepareImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, or WebP image.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare the image.");
    for (let size = 1600; size >= 500; size = Math.floor(size * 0.8)) {
      const ratio = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/webp", 0.78);
      if (data.startsWith("data:image/webp;") && data.length <= 220_000) return data;
    }
    throw new Error("This image is too detailed to save. Try a smaller image.");
  } finally { bitmap.close(); }
}
