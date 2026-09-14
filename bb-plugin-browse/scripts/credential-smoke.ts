import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { strict as assert } from "node:assert";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host";

const fixture = createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/html");
  if (req.url === "/submit" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (
      form.get("email") === "demo@example.test" &&
      form.get("password") === "bb-demo-only"
    ) {
      res.writeHead(303, {
        Location: "/success",
        "Set-Cookie": "demo=ok; HttpOnly; SameSite=Strict",
      });
      res.end();
    } else {
      res.statusCode = 400;
      res.end("Dummy credentials did not match");
    }
    return;
  }
  if (req.url === "/success") {
    res.end("<h1>Demo signed in</h1>");
    return;
  }
  res.end(
    `<form method="post" action="/submit"><label>Email<input id="email" name="email" autocomplete="username"></label><label>Password<input id="password" name="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>${req.url === "/changing" ? '<script>setTimeout(()=>location.replace("/changed"),1800)</script>' : ""}`,
  );
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const port = (fixture.address() as { port: number }).port;
const h = experimental_createHostEntryHarness(entry, {
  experimental_paths: {
    dataDir:
      process.env.BROWSE_TEST_HOST_DATA ??
      join(homedir(), ".bb/plugins/browse/host-data"),
    tempDir: "/tmp",
  },
});
async function wait(j: any) {
  const deadline = Date.now() + 30000;
  while (j.status === "running") {
    if (Date.now() > deadline) throw Error("Browser job timed out");
    await new Promise((r) => setTimeout(r, 50));
    j = await h.experimental_call("job", { id: j.id });
  }
  assert.equal(j.status, "succeeded", j.error);
  return j;
}
const id = `ab-credential-test-${Date.now()}`;
const request = {
  id,
  purpose: "Dummy login test",
  fields: [
    { selector: "#email", label: "Email", kind: "username" as const },
    { selector: "#password", label: "Password", kind: "password" as const },
  ],
  submitSelector: "button",
};
async function run(args: string[]) {
  return wait(
    await h.experimental_call("submit", {
      id,
      operation: { kind: "command", args },
    }),
  );
}
try {
  await wait(
    await h.experimental_call("connect", {
      id,
      mode: "managed",
      url: `http://127.0.0.1:${port}/login`,
      expiresAt: Date.now() + 120000,
    }),
  );
  let prepared = await h.experimental_call("credentialPrepare", request);
  await assert.rejects(
    h.experimental_call("submit", { id, operation: { kind: "observe" } }),
    /private credential/,
  );
  await assert.rejects(
    h.experimental_call("frame", { id }),
    /private credential/,
  );
  await assert.rejects(
    h.experimental_call("input", {
      id,
      input: { kind: "text", text: "blocked" },
    }),
    /private credential/,
  );
  const result = await h.experimental_call("credentialFill", {
    id,
    token: prepared.token,
    values: ["demo@example.test", "bb-demo-only"],
  });
  assert.deepEqual(result, { filled: true, count: 2 });
  await assert.rejects(
    h.experimental_call("credentialFill", {
      id,
      token: prepared.token,
      values: ["x", "x"],
    }),
    /expired/,
  );
  const signedIn = await run(["get", "text", "h1"]);
  assert.ok(signedIn.output.includes("Demo signed in"));
  console.log(
    "PASS: dummy credentials filled, one submission, signed-in page verified; observations and viewer blocked during request.",
  );
  await run(["open", `http://127.0.0.1:${port}/changing`]);
  prepared = await h.experimental_call("credentialPrepare", request);
  await new Promise((r) => setTimeout(r, 2100));
  await assert.rejects(
    h.experimental_call("credentialFill", {
      id,
      token: prepared.token,
      values: ["demo@example.test", "bb-demo-only"],
    }),
    /Could not complete/,
  );
  await run(["get", "url"]);
  prepared = await h.experimental_call("credentialPrepare", request);
  await h.experimental_call("credentialCancel", { id, token: prepared.token });
  await run(["get", "url"]);
  console.log(
    "PASS: navigation rejects stale delivery; failure and cancellation release the browser lock.",
  );
} finally {
  await h.experimental_dispose();
  fixture.closeAllConnections();
  fixture.close();
}
