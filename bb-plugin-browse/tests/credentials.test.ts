// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  bindCredentialFormSource,
  fillCredentialFormSource,
  clearCredentialFormSource,
} from "../src/credentials";
const bindCredentialForm = new Function(
  `return (${bindCredentialFormSource})`,
)();
const fillCredentialForm = new Function(
  `return (${fillCredentialFormSource})`,
)();
const clearCredentialForm = new Function(
  `return (${clearCredentialFormSource})`,
)();
const fields = [
  { selector: "#email", kind: "username" },
  { selector: "#pass", kind: "password" },
];
beforeEach(() => {
  history.replaceState(null, "", "/login");
  document.body.innerHTML =
    '<form method="post"><input id="email"><input id="pass" type="password"><button id="next" type="button">Continue</button></form>';
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 40,
  } as DOMRect);
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    visibility: "visible",
    display: "block",
    opacity: "1",
  } as CSSStyleDeclaration);
});
afterEach(() => vi.restoreAllMocks());
it("fills and clicks once, then erases retained fields without returning values", () => {
  const binding = bindCredentialForm(fields, "#next"),
    click = vi.fn();
  binding.button.addEventListener("click", click);
  expect(
    fillCredentialForm.call(binding, ["dummy-user", "dummy-password"]),
  ).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect((document.querySelector("#pass") as HTMLInputElement).value).toBe(
    "dummy-password",
  );
  clearCredentialForm.call(binding);
  expect((document.querySelector("#pass") as HTMLInputElement).value).toBe("");
});
it.each([
  "navigation",
  "replacement",
  "form destination",
  "button destination",
  "unmasked password",
])("rejects %s before inserting a credential", (change) => {
  const binding = bindCredentialForm(fields, "#next");
  if (change === "navigation") history.replaceState(null, "", "/changed");
  if (change === "replacement")
    document.querySelector("#pass")!.outerHTML =
      '<input id="pass" type="password">';
  if (change === "form destination")
    document.querySelector("form")!.action = "https://another.test/";
  if (change === "button destination")
    document.querySelector("button")!.formAction = "https://another.test/";
  if (change === "unmasked password")
    (document.querySelector("#pass") as HTMLInputElement).type = "text";
  expect(() =>
    fillCredentialForm.call(binding, ["dummy-user", "dummy-password"]),
  ).toThrow();
  expect((document.querySelector("#email") as HTMLInputElement).value).toBe("");
});
it("refuses a destination changed by an input handler before clicking", () => {
  const binding = bindCredentialForm(fields, "#next"),
    click = vi.fn();
  binding.button.addEventListener("click", click);
  binding.nodes[0].addEventListener("input", () => {
    document.querySelector("form")!.action = "https://another.test/";
  });
  expect(() =>
    fillCredentialForm.call(binding, ["dummy-user", "dummy-password"]),
  ).toThrow();
  clearCredentialForm.call(binding);
  expect(click).not.toHaveBeenCalled();
  expect((document.querySelector("#pass") as HTMLInputElement).value).toBe("");
});
