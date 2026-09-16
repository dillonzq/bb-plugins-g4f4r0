import { it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  observeExpression,
  deepQuerySource,
  elementExpression,
} from "../src/observe";
function fixture() {
  const dom = new JSDOM("<custom-app></custom-app>", {
    url: "https://example.test/",
    runScripts: "outside-only",
  });
  const w = dom.window;
  Object.defineProperty(w, "CSS", { value: { escape: (s: string) => s } });
  Object.defineProperty(w.HTMLElement.prototype, "getBoundingClientRect", {
    value: () => ({ x: 10, y: 20, width: 30, height: 40 }),
  });
  const a = w.document.querySelector("custom-app")!;
  const root = a.attachShadow({ mode: "open" });
  root.innerHTML = '<tool-box></tool-box><input id="field" value="old">';
  const tools = root.querySelector("tool-box")!.attachShadow({ mode: "open" });
  tools.innerHTML =
    '<custom-tool title="Pencil"></custom-tool><custom-tool title="Brush"></custom-tool>';
  return { dom, w, a, root, tools };
}
it("returns unique selectors for direct siblings of nested shadow roots", () => {
  const f = fixture();
  const r: any = f.w.eval(observeExpression);
  const pencil = r.elements.find((e: any) => e.label === "Pencil"),
    brush = r.elements.find((e: any) => e.label === "Brush");
  expect(pencil.selector).not.toBe(brush.selector);
  for (const e of [pencil, brush])
    expect(
      f.w.eval(
        `(()=>{${deepQuerySource}return deepQuery(${JSON.stringify(e.selector)}).length})()`,
      ),
    ).toBe(1);
  f.dom.window.close();
});
it("preserves labels and infers semantics for custom clickable controls", () => {
  const f = fixture();
  f.root.innerHTML = '<span id="custom" style="cursor:pointer" aria-expanded="false">Phasellus link</span>';
  const r: any = f.w.eval(observeExpression);
  expect(r.elements).toContainEqual(expect.objectContaining({ selector: "custom-app >>> #custom", role: "button", label: "Phasellus link", expanded: "false" }));
  f.w.close();
});
it("checks occlusion before a shadow element click", async () => {
  const f = fixture();
  const field = f.root.querySelector("input")!;
  (field as any).scrollIntoView = () => {};
  (f.w.document as any).elementFromPoint = () => f.a;
  (f.root as any).elementFromPoint = () => field;
  expect(
    await f.w.eval(elementExpression("custom-app >>> #field")),
  ).toMatchObject({
    x: 25,
    y: 40,
    editable: true,
  });
  (f.w.document as any).elementFromPoint = () => f.w.document.body;
  await expect(
    f.w.eval(elementExpression("custom-app >>> #field")),
  ).rejects.toThrow(/covers this target: <body>/);
  f.dom.window.close();
});

it.each([
  "<input readonly>",
  "<fieldset disabled><input></fieldset>",
  "<div inert><input></div>",
  '<div aria-disabled="true"><input></div>',
  '<input type="checkbox">',
])("rejects non-writable fields before any input: %s", async (html) => {
  const f = fixture();
  f.root.innerHTML = html;
  await expect(
    f.w.eval(elementExpression("custom-app >>> input", "fill")),
  ).rejects.toThrow(/disabled|writable/);
  f.w.close();
});
it("uses the visible portion of oversized elements for clicks", async () => {
  const f = fixture(),
    field = f.root.querySelector("input")!;
  (field as any).scrollIntoView = () => {};
  Object.defineProperty(field, "getBoundingClientRect", {
    value: () => ({ x: 0, y: 0, width: 5000, height: 40 }),
  });
  (f.w.document as any).elementFromPoint = () => f.a;
  (f.root as any).elementFromPoint = () => field;
  const result: any = await f.w.eval(elementExpression("custom-app >>> input"));
  expect(result.x).toBe(f.w.innerWidth / 2);
  f.w.close();
});
