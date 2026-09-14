import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { strict as assert } from "node:assert";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host";

const cycles = 3;
const rows: { cycle: number; name: string; pass: boolean; ms: number; detail?: string }[] =
  [];

function log(
  cycle: number,
  name: string,
  pass: boolean,
  started: number,
  detail?: string,
) {
  const row = { cycle, name, pass, ms: Date.now() - started, detail };
  rows.push(row);
  console.log(JSON.stringify(row));
  if (!pass) throw Error(`cycle ${cycle}: ${name}${detail ? `: ${detail}` : ""}`);
}

const fixture = createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/submit" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (
      form.get("email") === "demo@example.test" &&
      form.get("password") === "bb-demo-only"
    ) {
      res.writeHead(303, { Location: "/success" });
      res.end();
      return;
    }
    res.statusCode = 400;
    res.end("no");
    return;
  }
  if (req.url === "/success") {
    res.end("<h1>Demo signed in</h1>");
    return;
  }
  if (req.url === "/shadow") {
    res.end(`<!doctype html><form id="f" method="post" action="/submit">
      <div id="host"></div>
      <button id="go" type="button">Continue</button>
    </form>
    <script>
      const s = document.querySelector("#host").attachShadow({mode:"open"});
      s.innerHTML = '<input id="email" name="email"><input id="password" name="password" type="password">';
      document.querySelector("#go").onclick = () => {
        const f = document.getElementById("f");
        for (const [name, sel] of [["email","#email"],["password","#password"]]) {
          const src = s.querySelector(sel);
          const extra = document.createElement("input");
          extra.name = name;
          extra.value = src.value;
          f.append(extra);
        }
        f.submit();
      };
    </script>`);
    return;
  }
  res.end(
    `<form method="post" action="/submit"><input id="email" name="email"><input id="password" name="password" type="password"><button type="submit">Sign in</button></form>`,
  );
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const port = (fixture.address() as { port: number }).port;
const dataDir =
  process.env.BROWSE_TEST_HOST_DATA ??
  join(homedir(), ".bb/plugins/browse/host-data");
const h = experimental_createHostEntryHarness(entry, {
  experimental_paths: { dataDir, tempDir: "/tmp" },
});

async function wait(j: any) {
  const deadline = Date.now() + 45000;
  while (j.status === "running") {
    if (Date.now() > deadline) throw Error("job timeout " + j.id);
    await new Promise((r) => setTimeout(r, 40));
    j = await h.experimental_call("job", { id: j.id });
  }
  return j;
}

try {
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const id = `ab-race-${cycle}-${Date.now().toString(36)}`;
    const request = {
      id,
      purpose: "race",
      fields: [
        { selector: "#email", label: "Email", kind: "username" as const },
        { selector: "#password", label: "Password", kind: "password" as const },
      ],
      submitSelector: "button",
    };

    let t = Date.now();
    let j = await wait(
      await h.experimental_call("connect", {
        id,
        mode: "managed",
        url: `http://127.0.0.1:${port}/login`,
        expiresAt: Date.now() + 180000,
      }),
    );
    log(cycle, "connect", j.status === "succeeded", t, j.error);

    t = Date.now();
    const raced = await Promise.allSettled([
      h.experimental_call("credentialPrepare", request),
      h.experimental_call("credentialPrepare", request),
    ]);
    const won = raced.filter((r) => r.status === "fulfilled");
    const lost = raced.filter((r) => r.status === "rejected");
    log(
      cycle,
      "double prepare exclusive",
      won.length === 1 && lost.length === 1,
      t,
      JSON.stringify(raced.map((r) => r.status)),
    );
    const prepared =
      won[0]!.status === "fulfilled" ? won[0].value : undefined;
    assert.ok(prepared?.token);

    t = Date.now();
    const frames = await Promise.all(
      Array.from({ length: 8 }, () => h.experimental_call("frame", { id })),
    );
    log(
      cycle,
      "concurrent frames during lock",
      frames.every((f) => f.data && f.width > 0),
      t,
    );

    t = Date.now();
    const blocked = await Promise.allSettled([
      h.experimental_call("submit", { id, operation: { kind: "observe" } }),
      h.experimental_call("input", { id, input: { kind: "text", text: "x" } }),
    ]);
    log(
      cycle,
      "observe and input blocked",
      blocked.every(
        (r) =>
          r.status === "rejected" &&
          String((r as PromiseRejectedResult).reason).includes("credential"),
      ),
      t,
    );

    t = Date.now();
    const fillAndStale = await Promise.allSettled([
      h.experimental_call("credentialFill", {
        id,
        token: prepared.token,
        values: ["demo@example.test", "bb-demo-only"],
      }),
      h.experimental_call("credentialFill", {
        id,
        token: prepared.token,
        values: ["demo@example.test", "bb-demo-only"],
      }),
    ]);
    const fills = fillAndStale.filter((r) => r.status === "fulfilled");
    log(
      cycle,
      "double fill exclusive",
      fills.length === 1,
      t,
      JSON.stringify(fillAndStale.map((r) => r.status)),
    );

    t = Date.now();
    j = await wait(
      await h.experimental_call("submit", {
        id,
        operation: { kind: "command", args: ["get", "text", "h1"] },
      }),
    );
    log(
      cycle,
      "signed in after fill",
      j.status === "succeeded" && String(j.output).includes("Demo signed in"),
      t,
      j.error,
    );

    t = Date.now();
    j = await wait(
      await h.experimental_call("submit", {
        id,
        operation: {
          kind: "command",
          args: ["open", `http://127.0.0.1:${port}/shadow`],
        },
      }),
    );
    log(cycle, "open shadow login", j.status === "succeeded", t, j.error);

    t = Date.now();
    const shadowReq = {
      ...request,
      submitSelector: "#go",
    };
    const shadowPrep = await h.experimental_call("credentialPrepare", shadowReq);
    const shadowFill = await h.experimental_call("credentialFill", {
      id,
      token: shadowPrep.token,
      values: ["demo@example.test", "bb-demo-only"],
    });
    j = await wait(
      await h.experimental_call("submit", {
        id,
        operation: { kind: "command", args: ["get", "text", "h1"] },
      }),
    );
    log(
      cycle,
      "shadow fields and type=button continue",
      shadowFill.filled === true && String(j.output).includes("Demo signed in"),
      t,
    );

    t = Date.now();
    j = await wait(
      await h.experimental_call("submit", {
        id,
        operation: {
          kind: "command",
          args: ["open", `http://127.0.0.1:${port}/login`],
        },
      }),
    );
    const prep = await h.experimental_call("credentialPrepare", request);
    const cancelVsObserve = await Promise.allSettled([
      h.experimental_call("credentialCancel", { id, token: prep.token }),
      h.experimental_call("submit", { id, operation: { kind: "observe" } }),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    const after = await h.experimental_call("submit", {
      id,
      operation: { kind: "observe" },
    });
    const observeAfter = await wait(after);
    log(
      cycle,
      "cancel unlocks observe",
      observeAfter.status === "succeeded",
      t,
      JSON.stringify(cancelVsObserve.map((r) => r.status)),
    );

    t = Date.now();
    const released = await Promise.all(
      Array.from({ length: 4 }, () => h.experimental_call("release", { id })),
    );
    log(
      cycle,
      "concurrent release",
      released.every((r) => r.released === true),
      t,
    );
    const inspect = await h.experimental_call("inspect", { id });
    log(cycle, "released after close", inspect.status === "released", t);
  }
  console.log(
    JSON.stringify({
      cycles,
      passed: rows.filter((r) => r.pass).length,
      total: rows.length,
    }),
  );
} finally {
  await h.experimental_dispose();
  fixture.closeAllConnections();
  fixture.close();
}
