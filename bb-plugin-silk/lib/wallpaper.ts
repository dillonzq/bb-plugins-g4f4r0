import type { Config } from "./config";
import { animateAmbient } from "./ambient";
import { snapshot } from "./fade";
import { animatePhoto } from "./photo";

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
  let cancelled = false, cancelPhoto = () => {};
  const from = crossfade ? snapshot(canvas) : null;
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
    canvas.width = w; canvas.height = h;
    const dispose = animateAmbient(canvas, base, dark, from);
    canvas.dataset.ready = "";
    return dispose;
  }
  decode(config.image).then((image) => {
    if (cancelled) return;
    cancelPhoto = animatePhoto(canvas, image, from);
  }, () => {
    if (cancelled || canvas.hasAttribute("data-ready")) return;
    canvas.width = w; canvas.height = h;
    const visible = canvas.getContext("2d");
    if (visible) { visible.fillStyle = `rgb(${base.slice(0, 3).join(",")})`; visible.fillRect(0, 0, w, h); }
  });
  return () => { cancelled = true; cancelPhoto(); };
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
