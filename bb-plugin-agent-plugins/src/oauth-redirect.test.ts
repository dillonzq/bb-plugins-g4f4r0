import { describe, expect, it } from "vitest";
import { oauthRedirectBase, serverAppUrl } from "./oauth-redirect.js";

describe("oauthRedirectBase", () => {
  it("prefers an explicit setting over the public app URL", () => {
    expect(oauthRedirectBase({
      setting: "https://g4f4r0.getbb.app/",
      appUrl: "https://app.example",
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("https://g4f4r0.getbb.app");
  });

  it("uses the public app URL when no setting is set", () => {
    expect(oauthRedirectBase({
      setting: "  ",
      appUrl: "https://g4f4r0.getbb.app",
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("https://g4f4r0.getbb.app");
  });

  it("falls back to loopback when nothing public is configured", () => {
    expect(oauthRedirectBase({
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("http://127.0.0.1:38886");
  });
});

describe("serverAppUrl", () => {
  it("reads experimental_appUrl when present", () => {
    expect(serverAppUrl({ experimental_appUrl: "https://g4f4r0.getbb.app" })).toBe("https://g4f4r0.getbb.app");
    expect(serverAppUrl({ loopbackBaseUrl: "http://127.0.0.1:38886" })).toBeNull();
  });
});
