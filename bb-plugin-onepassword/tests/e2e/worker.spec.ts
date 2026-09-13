import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { runBrowser } from "../../service/src/worker";
import { mappingSchema } from "../../service/src/schema";
test("protected browser logs in, uses named controls, masks text, and rejects other origins", async () => {
  const mapping = mappingSchema.parse({
    id: "browser",
    label: "Test login",
    kind: "browser",
    projectIds: ["test-project"],
    workerId: "worker",
    profile: "browser",
    profileDigest: "a".repeat(64),
    fields: {
      USERNAME: "op://test/login/username",
      PASSWORD: "op://test/login/password",
    },
    origins: ["http://localhost:43819"],
  });
  const actions = [
      { id: "inspect", kind: "inspect" },
      { id: "fill", kind: "fill", control: "note", value: "An ordinary note" },
      { id: "save", kind: "click", control: "save" },
      { id: "outside", kind: "navigate", url: "https://example.com/" },
      { id: "close", kind: "close" },
    ],
    results: any[] = [];
  let ready = false;
  const result = await runBrowser(
    {
      requestId: randomUUID(),
      mapping,
      input: {
        mappingId: "browser",
        projectId: "test-project",
        threadId: "test-thread",
        reason: "Test",
        url: "http://localhost:43819/fixture/login",
        idempotencyKey: randomUUID(),
      },
      values: { USERNAME: "dummy-user", PASSWORD: "dummy-only-password" },
      deadline: Date.now() + 30000,
    },
    {
      kind: "browser",
      executable: process.env.ONEPASSWORD_TEST_CHROME!,
      origins: ["http://localhost:43819"],
      resourceOrigins: [],
      username: "#username",
      password: "#password",
      submit: "#submit",
      success: "#success",
      controls: {
        status: { kind: "text", selector: "#status" },
        note: { kind: "fill", selector: "#note" },
        save: { kind: "click", selector: "#save" },
      },
    },
    new AbortController().signal,
    async (path, body) => {
      if (path.endsWith("/ready")) {
        ready = true;
        return { ok: true };
      }
      if (path.endsWith("/next")) {
        expect(ready).toBe(true);
        return { action: actions.shift() ?? null };
      }
      results.push(body);
      return { ok: true };
    },
  );
  expect(result.ok).toBe(true);
  expect(ready).toBe(true);
  expect(results.find((r) => r.id === "inspect").text).toContain("[redacted]");
  expect(results.find((r) => r.id === "save").text).toContain("Note saved");
  expect(results.find((r) => r.id === "outside").ok).toBe(false);
  expect(JSON.stringify(results)).not.toContain("dummy-only-password");
});
