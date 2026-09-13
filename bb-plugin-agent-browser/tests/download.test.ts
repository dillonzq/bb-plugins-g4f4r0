import { it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { downloadExpression } from "../src/download";
function fixture(html: string) {
  const dom = new JSDOM(html, {
    url: "https://example.test/page/",
    runScripts: "outside-only",
  });
  const fetch = vi.fn(async (_url: unknown, _options?: unknown) => new Response("hello"));
  Object.assign(dom.window, { fetch, AbortController });
  return { dom, fetch };
}
it("resolves links against document baseURI, including shadow roots", async () => {
  const { dom, fetch } = fixture(
    '<base href="https://example.test/files/"><custom-app></custom-app>',
  );
  dom.window.document
    .querySelector("custom-app")!
    .attachShadow({ mode: "open" }).innerHTML = '<a href="report.csv">File</a>';
  const result = await dom.window.eval(downloadExpression("custom-app >>> a"));
  expect(result).toBe("data:text/plain;charset=utf-8;base64,aGVsbG8=");
  expect(String(fetch.mock.calls[0]?.[0])).toBe(
    "https://example.test/files/report.csv",
  );
  dom.window.close();
});
it("rejects ambiguous links without fetching", async () => {
  const { dom, fetch } = fixture('<a href="one">One</a><a href="two">Two</a>');
  await expect(dom.window.eval(downloadExpression("a"))).rejects.toThrow(
    "found 2",
  );
  expect(fetch).not.toHaveBeenCalled();
  dom.window.close();
});
it("rejects advertised oversize downloads before consuming the body", async () => {
  const { dom, fetch } = fixture('<a href="large">Large</a>');
  const cancel = vi.fn();
  fetch.mockImplementation(
    async () =>
      ({
        ok: true,
        headers: new Headers({ "content-length": String(17 * 1024 * 1024) }),
        body: { getReader: () => ({ cancel }) },
      }) as any,
  );
  await expect(dom.window.eval(downloadExpression("a"))).rejects.toThrow(
    "16 MB",
  );
  expect(cancel).toHaveBeenCalledOnce();
  dom.window.close();
});
it("rejects unsupported protocols without fetching", async () => {
  const { dom, fetch } = fixture('<a href="javascript:alert(1)">Bad</a>');
  await expect(dom.window.eval(downloadExpression("a"))).rejects.toThrow(
    "Unsupported",
  );
  expect(fetch).not.toHaveBeenCalled();
  dom.window.close();
});
