import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Run against a local path installation. Browser RPC is intercepted so image
// tests do not replace the user's saved background or publish realtime changes.
const base = process.env.BB_TEST_URL || "http://127.0.0.1:38886";
const artifacts = process.env.SILK_ARTIFACTS || "/tmp/silk-checks";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: "dark" });
  let config = { image: null };
  await context.route("**/api/v1/plugins/silk/rpc/*", async (route) => {
    if (route.request().url().endsWith("/save")) config = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, result: config } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".silk-customize").waitFor();
  const measure = () => page.locator(".silk-home").evaluate((host) => {
    const form = host.querySelector("form").getBoundingClientRect();
    const metadata = host.querySelector("form + div").getBoundingClientRect();
    const outer = host.getBoundingClientRect();
    return {
      dx: Math.abs((form.left + form.right) / 2 - (outer.left + outer.right) / 2),
      dy: Math.abs((Math.min(metadata.top, form.top) + Math.max(metadata.bottom, form.bottom)) / 2 - (outer.top + outer.bottom) / 2),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  let bounds = await measure();
  assert.equal(await page.locator('.silk-shield').count(), 1);
  assert.equal(await page.locator('.silk-shield').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  assert.match(await page.locator('.silk-shield').evaluate(el => getComputedStyle(el).backgroundImage), /^linear-gradient/);
  assert.equal(await page.locator('.silk-composer-shadow').count(), 1);
  assert.equal(await page.locator('.silk-composer-shadow').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  assert.notEqual(await page.locator('.silk-composer-shadow').evaluate(el => getComputedStyle(el).boxShadow), 'none');
  assert(bounds.dx < 2 && bounds.dy < 12 && !bounds.overflow, JSON.stringify(bounds));
  const nativeComparison = await page.evaluate(() => {
    const shell = document.querySelector('[data-promptbox-shell]');
    const properties = ['width', 'height', 'padding', 'margin', 'gap', 'display', 'flex-direction', 'order', 'font-family', 'font-size', 'line-height', 'color', 'background-color', 'border', 'border-radius', 'box-shadow'];
    const snapshot = () => {
      const root = shell.getBoundingClientRect();
      return [shell, ...shell.querySelectorAll('*')].map(el => {
        const r = el.getBoundingClientRect(), style = getComputedStyle(el);
        return { geometry: [r.width, r.height, r.width ? r.x - root.x : 0, r.height ? r.y - root.y : 0].map(v => Math.round(v * 100) / 100), styles: properties.map(p => style.getPropertyValue(p)) };
      });
    };
    const centered = snapshot();
    const changes = ['silk-home', 'silk-page', 'silk-column', 'silk-composer'].flatMap(name => [...document.querySelectorAll('.' + name)].map(el => [el, name]));
    changes.forEach(([el, name]) => el.classList.remove(name));
    const native = snapshot();
    changes.forEach(([el, name]) => el.classList.add(name));
    return { centered, native };
  });
  assert.deepEqual(nativeComparison.centered, nativeComparison.native, 'Composer pixels, geometry and styles must match native BB');
  const artwork = page.locator('.silk-wallpaper');
  const beforeMotion = await artwork.evaluate(el => el.toDataURL());
  await page.waitForTimeout(850);
  assert.notEqual(await artwork.evaluate(el => el.toDataURL()), beforeMotion, 'Ambient background should animate');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const still = await artwork.evaluate(el => el.toDataURL());
  await page.waitForTimeout(300);
  assert.equal(await artwork.evaluate(el => el.toDataURL()), still, 'Reduced motion should freeze the field');
  await page.evaluate(() => document.documentElement.style.setProperty('--primary', '#00d080'));
  await page.waitForTimeout(150);
  const themeColor = await artwork.evaluate(el => {
    const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return { r, g, b };
  });
  assert(themeColor.g > themeColor.r * 2 && themeColor.g > themeColor.b, 'Ambient color must follow primary');
  await page.screenshot({ path: `${artifacts}/ambient-theme.png` });
  await page.evaluate(() => document.documentElement.style.removeProperty('--primary'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  console.log('PASS: native composer geometry/styles, animation, primary theme color and reduced motion');
  await page.locator('[id="root-compose-prompt"]').fill("Silk test draft — do not submit");
  await page.locator('[id="root-compose-prompt"]').evaluate((el) => { window.silkOriginalEditor = el; });
  await page.screenshot({ path: `${artifacts}/homepage-dark.png` });
  await page.getByRole("button", { name: "Customize Silk homepage" }).click();
  await page.getByRole("menuitem", { name: "Choose image", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  const iconLayoutDifferences = await page.evaluate(() => {
    const freeze = document.createElement("style"); freeze.textContent = "* { animation: none !important; transition: none !important; }"; document.head.append(freeze);
    const differences = [];
    for (const el of document.querySelectorAll('span[data-icon]:has(>svg[data-silk-remix])')) {
      const before = el.getBoundingClientRect();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "24"); svg.setAttribute("height", "24");
      svg.setAttribute("class", el.className.replace(/^inline-flex size-6 shrink-0\s*/, ""));
      if (el.hasAttribute("style")) svg.setAttribute("style", el.getAttribute("style"));
      el.replaceWith(svg); const after = svg.getBoundingClientRect(); svg.replaceWith(el);
      if (["x", "y", "width", "height"].some(key => Math.abs(before[key] - after[key]) > .5)) differences.push(el.dataset.icon);
    }
    freeze.remove(); return differences;
  });
  assert.deepEqual(iconLayoutDifferences, [], "Remix wrappers must match native SVG bounds in the sidebar, composer and menu");
  assert.equal(await page.getByRole("slider").count(), 0);
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${artifacts}/settings.png` });

  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 500;
    const ctx = canvas.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, 800, 500);
    gradient.addColorStop(0, "#153c2b"); gradient.addColorStop(0.5, "#c2d484"); gradient.addColorStop(1, "#3f7775");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 800, 500);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Choose image", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "test-background.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForFunction(() => document.querySelector('.silk-customize')?.getAttribute('aria-busy') === 'false');
  assert(config.image.startsWith("data:image/webp;base64,"));
  assert(config.image.length <= 220_000);
  await page.keyboard.press("Escape");
  assert(await page.locator('[id="root-compose-prompt"]').evaluate((el) => el === window.silkOriginalEditor));
  assert.match(await page.locator('[id="root-compose-prompt"]').innerText(), /Silk test draft/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${artifacts}/background-dark.png` });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${artifacts}/background-light.png` });
  await page.getByRole("button", { name: "Customize Silk homepage" }).click();
  await page.getByRole("menuitem", { name: "Change image", exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Remove image", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.silk-customize')?.getAttribute('aria-busy') === 'false');
  assert.equal(config.image, null);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator(".silk-customize").waitFor();
  assert.equal(await page.locator(".silk-wallpaper").count(), 1);

  console.log("PASS: image upload, removal, theme changes, draft identity and refresh");
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.waitForTimeout(250);
    bounds = await measure();
    assert(bounds.dx < 2 && bounds.dy < 12 && !bounds.overflow, JSON.stringify({ width, ...bounds }));
  }
  console.log("PASS: responsive bounds");
  for (let i = 0; i < 2; i++) {
    await page.getByText("Plugins", { exact: true }).first().click();
    await page.waitForFunction(() => !document.querySelector(".silk-home"));
    assert.equal(await page.locator(".silk-wallpaper, .silk-shield, .silk-composer-shadow, .silk-customize").count(), 0);
    await page.goBack();
    await page.locator(".silk-customize").waitFor();
    assert.equal(await page.locator(".silk-wallpaper").count(), 1);
  }
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const mobilePage = await mobile.newPage();
  mobilePage.setDefaultTimeout(10000);
  mobilePage.on("pageerror", (error) => errors.push(error.message));
  await mobilePage.goto(base);
  await mobilePage.locator(".silk-customize").waitFor();
  await mobilePage.screenshot({ path: `${artifacts}/homepage-mobile.png` });
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobilePage.getByRole("button", { name: "Customize Silk homepage" }).click();
  await mobilePage.getByText("Change image", { exact: true }).waitFor();
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log("PASS: desktop/mobile centering, one image setting, upload/remove, light/dark changes, draft preservation, refresh, and navigation cleanup.");
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); }
