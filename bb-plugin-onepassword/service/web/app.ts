import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
const root = document.querySelector<HTMLElement>("#app")!;
let busy = false,
  authenticated = false,
  tab = "requests";
const esc = (x: unknown) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
async function api(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error ?? "Request failed.");
  return data;
}
function error(e: unknown) {
  let box = document.getElementById("error");
  if (!box) {
    box = document.createElement("div");
    box.id = "error";
    box.className = "notice error";
    box.setAttribute("role", "alert");
    root.prepend(box);
  }
  box.textContent =
    e instanceof Error ? e.message : "Could not complete the request.";
}
function bind(id: string, fn: () => Promise<void>) {
  document.getElementById(id)?.addEventListener("click", () => {
    void action(fn);
  });
}
async function action(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  document.getElementById("error")?.remove();
  try {
    await fn();
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
async function prove(optionsPath: string, verifyPath: string, body?: unknown) {
  const { options, challengeId } = await api(optionsPath, body ?? {});
  const response = await startAuthentication({ optionsJSON: options });
  await api(verifyPath, {
    challengeId,
    response,
    ...(body ? { action: body } : {}),
  });
}
async function refresh() {
  const state = await api("/auth/status");
  authenticated = state.authenticated;
  if (!state.enrolled) {
    root.innerHTML = `<div class="narrow"><div class="intro"><h1>Your approval key.</h1><p class="muted">Create a passkey for this service. Save it in 1Password to use it from your supported devices.</p></div><div class="card"><h2>Set up your first device</h2><p class="origin">${esc(state.origin)}</p><label for="bootstrap">Service enrollment code</label><input id="bootstrap" type="password" autocomplete="off" spellcheck="false"><p class="muted">Get this from <code>bootstrap.txt</code> on your trusted service host. It is used only for the first enrollment.</p><button id="enroll">Create approval passkey</button></div></div>`;
    bind("enroll", async () => {
      const bootstrap = (
        document.getElementById("bootstrap") as HTMLInputElement
      ).value;
      const { options, challengeId } = await api("/auth/register/options", {
        bootstrap,
      });
      const response = await startRegistration({ optionsJSON: options });
      await api("/auth/register/verify", { bootstrap, challengeId, response });
      await refresh();
    });
    return;
  }
  if (!authenticated) {
    root.innerHTML = `<div class="narrow"><div class="intro"><h1>Approve with confidence.</h1><p class="muted">Review the destination and access requested by BB, then approve with your passkey.</p></div><div class="card"><h2>Unlock approvals</h2><p class="origin">${esc(state.origin)}</p><p class="muted">Use the approval passkey saved in 1Password. Your device may offer another device or a QR code.</p><button id="unlock">Unlock with passkey</button><p class="notice">This is a community integration. Device and cross-device passkey support depends on your browser and 1Password setup.</p></div></div>`;
    bind("unlock", async () => {
      await prove("/auth/login/options", "/auth/login/verify");
      await refresh();
    });
    return;
  }
  await dashboard();
}
async function dashboard() {
  const state = await api("/owner/state");
  const pending = state.requests.filter((r: any) => r.status === "pending");
  root.innerHTML = `<div class="row"><div><h1>You’re in control.</h1><p class="muted">${pending.length ? `${pending.length} request${pending.length === 1 ? "" : "s"} waiting for your decision.` : "No approvals waiting. You’re all caught up."}</p></div><button class="secondary" id="lock">Lock</button></div><div class="tabs"><button id="requests-tab" class="${tab === "requests" ? "" : "secondary"}">Requests</button><button id="settings-tab" class="${tab === "settings" ? "" : "secondary"}">Settings</button><button id="refresh" class="secondary">Refresh</button></div><div id="content"></div>`;
  bind("lock", async () => {
    await api("/owner/logout", {});
    await refresh();
  });
  bind("refresh", refresh);
  for (const t of ["requests", "settings"])
    bind(t + "-tab", async () => {
      tab = t;
      await dashboard();
    });
  const content = document.getElementById("content")!;
  if (tab === "requests") {
    content.innerHTML = pending.length
      ? pending
          .map(
            (r: any) =>
              `<article class="card" id="request-${esc(r.id)}"><div class="row"><h2>${esc(r.label)}</h2><span class="badge">${esc(r.kind)}</span></div><p>${esc(r.reason)}</p><dl><dt>Project</dt><dd><code>${esc(r.projectId)}</code></dd><dt>Thread</dt><dd><code>${esc(r.threadId)}</code></dd><dt>Destination</dt><dd>${esc(r.url ?? r.workerId)}</dd><dt>Worker / profile</dt><dd>${esc(r.workerId)} / ${esc(r.profile)}</dd><dt>Profile digest</dt><dd><code>${esc(r.profileDigest ?? "Approval test")}</code></dd><dt>Access</dt><dd>${esc(r.variables.join(", ") || "No credentials — approval test")}</dd><dt>Duration</dt><dd>Up to ${esc(r.maxSeconds)} seconds</dd><dt>Request expires</dt><dd>${esc(new Date(r.expiresAt).toLocaleTimeString())}</dd></dl>${r.kind === "environment" ? '<p class="notice warning">The program receiving these variables can read them. Approve only a worker profile and code you trust.</p>' : ""}<div class="actions"><button id="approve-${esc(r.id)}">Approve with passkey</button><button class="secondary" id="deny-${esc(r.id)}">Deny</button></div></article>`,
          )
          .join("")
      : '<div class="empty">New requests from BB will appear here.</div>';
    for (const r of pending) {
      bind("approve-" + r.id, async () => {
        await prove(
          "/owner/requests/" + r.id + "/options",
          "/owner/requests/" + r.id + "/approve",
        );
        await dashboard();
      });
      bind("deny-" + r.id, async () => {
        await api("/owner/requests/" + r.id + "/deny", {});
        await dashboard();
      });
    }
    const history = state.requests
      .filter((r: any) => r.status !== "pending")
      .slice(0, 30);
    if (history.length) {
      const box = document.createElement("section");
      box.className = "card";
      box.innerHTML =
        "<h2>Recent activity</h2>" +
        history
          .map(
            (r: any) =>
              `<div class="history row"><span>${esc(r.label)}<small>${esc(r.projectId)} · ${esc(new Date(r.createdAt).toLocaleString())}</small></span><span class="badge">${esc(r.status)}</span>${["running", "approved"].includes(r.status) ? `<button class="danger" id="stop-${esc(r.id)}">Revoke</button>` : ""}</div>`,
          )
          .join("");
      content.append(box);
      for (const r of history)
        bind("stop-" + r.id, async () => {
          await api("/owner/requests/" + r.id + "/deny", {});
          await dashboard();
        });
    }
    const target = location.hash.startsWith("#request=")
      ? location.hash.slice(9)
      : "";
    if (target)
      document
        .getElementById("request-" + target)
        ?.scrollIntoView({ block: "center" });
    return;
  }
  content.innerHTML = `<div class="grid"><section class="card"><div class="row"><h2>1Password connection</h2><span class="badge">${state.connected ? "Configured" : "Not connected"}</span></div><p class="muted">Use a service account restricted to a dedicated automation vault and the Environments you choose.</p><label for="token">Service account token</label><input type="password" id="token" autocomplete="off" spellcheck="false"><button id="save-token">${state.connected ? "Replace" : "Connect"} with passkey</button>${state.connected ? '<div class="actions"><button class="danger" id="disconnect">Disconnect & revoke active requests</button></div>' : ""}</section><section class="card"><h2>Trusted destinations</h2><p class="muted">Workers are provisioned by the service administrator. Keep this service and its keys outside the BB agent’s administrative access.</p>${state.workers.map((w: any) => `<p><strong>${esc(w.label)}</strong><br><code>${esc(w.id)}</code></p>`).join("")}<p class="notice">Keep an additional copy of your synced passkey available. Recovery requires trusted host administration; BB cannot reset your approval key.</p></section></div><section class="card"><h2>Credential mappings</h2><p class="muted">A mapping connects a BB project, a worker profile, and selected credentials. Changing it cancels pending approvals.</p>${state.mappings.map((m: any) => `<div class="history row"><span>${esc(m.label)}<small>${esc(m.id)} · ${esc(m.kind)} · ${esc(m.profile)}</small></span><button class="secondary" id="edit-${esc(m.id)}">Edit</button><button class="danger" id="delete-${esc(m.id)}">Remove</button></div>`).join("")}<details id="editor"><summary>Add or edit a mapping</summary><p class="muted">Use the mapping examples in the deployment guide. References stay on this service; BB sees only names.</p><label for="mapping">Mapping JSON</label><textarea id="mapping" spellcheck="false"></textarea><button id="save-mapping">Save with passkey</button></details></section><details><summary>Audit log</summary><div class="card">${state.audit.map((a: any) => `<div class="history"><code>${esc(a.event)}</code><small>${esc(new Date(a.at).toLocaleString())} · ${esc(a.subject)}</small></div>`).join("")}</div></details>`;
  const admin = async (a: unknown) => {
    await prove("/owner/action/options", "/owner/action/verify", a);
    await dashboard();
  };
  bind("save-token", async () => {
    const input = document.getElementById("token") as HTMLInputElement;
    const token = input.value;
    input.value = "";
    await admin({ kind: "token", token });
  });
  bind("disconnect", () => admin({ kind: "disconnect" }));
  bind("save-mapping", () =>
    admin({
      kind: "mapping",
      mapping: JSON.parse(
        (document.getElementById("mapping") as HTMLTextAreaElement).value,
      ),
    }),
  );
  for (const m of state.mappings) {
    bind("edit-" + m.id, async () => {
      (document.getElementById("editor") as HTMLDetailsElement).open = true;
      (document.getElementById("mapping") as HTMLTextAreaElement).value =
        JSON.stringify(m, null, 2);
      document.getElementById("mapping")?.focus();
    });
    bind("delete-" + m.id, () => admin({ kind: "deleteMapping", id: m.id }));
  }
}
void refresh().catch(error);
// Do not rerender while the user is editing or a passkey ceremony is active.
setInterval(() => {
  if (
    authenticated &&
    !busy &&
    tab === "requests" &&
    document.visibilityState === "visible"
  )
    void dashboard().catch(error);
}, 15000);
