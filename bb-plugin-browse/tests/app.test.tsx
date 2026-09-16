// @vitest-environment jsdom
import { it, expect } from "vitest";
import { fireEvent, within, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
const machines = [
  { hostId: "host_server", label: "server", connected: true },
  { hostId: "host_offline", label: "neo", connected: false },
  { hostId: "host_client", label: "pro", connected: true },
];
function health(hostId: string) {
  return {
    hostId,
    platform: "linux",
    arch: "x64",
    version: "4.1.0",
    installed: true,
    ffmpeg: true,
    browserInstalled: true,
    browserRunnable: true,
    browserPath: "/fortress",
    browserVersion: "Fortress 151",
    launchError: null,
    display: "virtual",
    xvfb: true,
    xkbcomp: true,
    xkbData: true,
  };
}
it("shows every machine, probes connected hosts independently, and keeps offline hosts out of RPC checks", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.navPanels).toHaveLength(0);
  expect(app.settingsSections).toHaveLength(1);
  expect(app.threadPanelActions).toHaveLength(1);
  expect(app.threadHeaderActions).toHaveLength(1);
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        machines: () => machines,
        probe: ({ hostId }: any) =>
          hostId === "host_client"
            ? {
                ...health(hostId),
                browserRunnable: false,
                launchError: "Missing libnss3",
              }
            : health(hostId),
      },
    },
  );
  try {
    await slot.findByText("Missing libnss3");
    expect(slot.queryByRole("combobox")).toBeNull();
    expect(
      within(slot.getByRole("region", { name: "server" })).getByText(
        "Launch verified",
      ),
    ).toBeTruthy();
    expect(
      within(slot.getByRole("region", { name: "server" })).getByText("Xvfb"),
    ).toBeTruthy();
    expect(
      within(slot.getByRole("region", { name: "server" })).getByText(
        "Keyboard compiler ready",
      ),
    ).toBeTruthy();
    expect(
      within(slot.getByRole("region", { name: "pro" })).getByText(
        "Installed, cannot launch",
      ),
    ).toBeTruthy();
    expect(
      within(slot.getByRole("region", { name: "neo" })).queryByRole("button"),
    ).toBeNull();
    expect(
      slot.inspection.rpcCalls
        .filter((c) => c.method === "probe")
        .map((c: any) => c.input.hostId)
        .sort(),
    ).toEqual(["host_client", "host_server"]);
    fireEvent.click(slot.getByRole("button", { name: "Recheck pro" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (c: any) => c.method === "probe" && c.input.hostId === "host_client",
        ),
      ).toHaveLength(2),
    );
  } finally {
    slot.lifecycle.unmount();
  }
});
it("installation targets its own machine and leaves other machine controls available", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let finish!: (value: any) => void;
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        machines: () => machines,
        probe: ({ hostId }: any) => health(hostId),
        setup: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    },
  );
  try {
    await waitFor(() =>
      expect(slot.getAllByText("Launch verified")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(
        slot
          .getByRole("button", { name: "Install dependencies on pro" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Install dependencies on pro" }),
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some(
          (c: any) => c.method === "setup" && c.input.hostId === "host_client",
        ),
      ).toBe(true),
    );
    expect(
      slot
        .getByRole("button", { name: "Recheck server" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      slot
        .getByRole("button", { name: "Recheck pro" })
        .hasAttribute("disabled"),
    ).toBe(true);
    finish({
      id: "install",
      hostId: "host_client",
      kind: "setup",
      status: "succeeded",
      startedAt: 1,
      durationMs: 10,
      artifacts: [],
    });
    await waitFor(() =>
      expect(
        slot
          .getByRole("button", { name: "Recheck pro" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(slot.queryByRole("alert")?.textContent ?? "").toBe("");
    expect(
      slot.inspection.rpcCalls.filter(
        (c: any) => c.method === "probe" && c.input.hostId === "host_client",
      ),
    ).toHaveLength(2);
  } finally {
    slot.lifecycle.unmount();
  }
});
it("opens a live thread panel when a managed session starts", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread_one", projectId: "project_one", isCompactViewport: false },
    {
      context: { threadId: "thread_one" },
      openThreadPanel: () => true,
      rpc: {
        list: () => [
          {
            id: "ab-live-1",
            status: "ready",
            url: "https://example.com/path",
          },
        ],
      },
    },
  );
  try {
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toEqual([
        expect.objectContaining({
          method: "openThreadPanel",
          options: expect.objectContaining({
            actionId: "live",
            params: { id: "ab-live-1", url: "https://example.com/path" },
            title: "example.com",
          }),
        }),
      ]),
    );
  } finally {
    slot.lifecycle.unmount();
  }
});
it("routine refresh preserves focus; explicit reveal reopens the selected panel", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread_one", projectId: "project_one", isCompactViewport: false },
    {
      context: { threadId: "thread_one" },
      openThreadPanel: () => true,
      rpc: {
        list: () => [
          {
            id: "ab-live-1",
            status: "ready",
            url: "https://example.com/path",
          },
        ],
      },
    },
  );
  try {
    await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
    await slot.emitRealtime("browser-changed", {});
    await new Promise((r) => setTimeout(r, 30));
    expect(slot.inspection.navigateCalls).toHaveLength(1);
    await slot.emitRealtime("browser-reveal", {
      threadId: "thread_one",
      id: "ab-live-1",
    });
    await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(2));
    expect(slot.inspection.navigateCalls[1]).toEqual(
      expect.objectContaining({
        method: "openThreadPanel",
        options: expect.objectContaining({
          actionId: "live",
          params: { id: "ab-live-1", url: "https://example.com/path" },
        }),
      }),
    );
  } finally {
    slot.lifecycle.unmount();
  }
});
it("renders the live iframe for a session id", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(app.threadPanelActions[0]!, {
    threadId: "thread_one",
    params: { id: "ab-live-1" },
  });
  try {
    const frame = slot.getByTitle("Live browser") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toContain(
      "/api/v1/plugins/browse/http/viewer?id=ab-live-1",
    );
  } finally {
    slot.lifecycle.unmount();
  }
});

it("opens separate tabs for sessions on different hosts and keeps the newest selected", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread_one", projectId: "project_one", isCompactViewport: false },
    {
      context: { threadId: "thread_one" },
      openThreadPanel: () => true,
      rpc: {
        list: () => [
          {
            id: "ab-new",
            status: "ready",
            url: "https://example.com",
            hostLabel: "pro",
            mode: "native",
          },
          {
            id: "ab-old",
            status: "ready",
            url: "https://example.com",
            hostLabel: "server",
            mode: "managed",
          },
        ],
      },
    },
  );
  try {
    await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(2));
    expect(slot.inspection.navigateCalls.map((c: any) => c.options)).toEqual([
      {
        actionId: "live",
        params: { id: "ab-old", url: "https://example.com" },
        title: "example.com",
      },
      {
        actionId: "live",
        params: { id: "ab-new", url: "https://example.com" },
        title: "example.com",
      },
    ]);
  } finally {
    slot.lifecycle.unmount();
  }
});

it("routes ordinary external clicks to the thread and reports recoverable launch errors", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let fail = true;
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: "thread_one", projectId: "project_one", isCompactViewport: false }, {
    context: { threadId: "thread_one" }, openThreadPanel: () => true,
    rpc: { list: () => [], "open-link": () => {
      if (fail) throw new Error("Host offline");
      return { session: { id: "clicked", url: "https://example.com/", hostLabel: "server" } };
    } },
  });
  const link = document.createElement("a");
  link.href = "https://example.com/"; link.target = "_blank";
  document.body.append(link);
  try {
    expect(fireEvent.click(link)).toBe(false);
    await slot.findByRole("alert");
    expect(slot.getByRole("alert").textContent).toContain("Host offline");
    expect(slot.inspection.rpcCalls.find(c => c.method === "open-link")?.input).toEqual({ threadId: "thread_one", url: link.href });
    fail = false;
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ options: expect.objectContaining({ params: { id: "clicked", url: "https://example.com/" } }) })));
  } finally { slot.lifecycle.unmount(); link.remove(); }
});

it("preserves app routes, modified clicks, downloads, and removes interception on unmount", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: "thread_one", projectId: "project_one", isCompactViewport: false }, { context: { threadId: "thread_one" }, rpc: { list: () => [] } });
  const link = document.createElement("a"); document.body.append(link);
  // A bubble listener prevents jsdom navigation, and records whether Browse consumed the event.
  let bubbled = 0;
  link.addEventListener("click", e => { bubbled++; e.preventDefault(); });
  try {
    link.href = "/projects/project"; fireEvent.click(link);
    link.href = window.location.origin + "/settings"; fireEvent.click(link);
    link.href = "https://example.com/"; fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { altKey: true });
    link.download = "file"; fireEvent.click(link); link.removeAttribute("download");
    link.target = "_parent"; fireEvent.click(link); link.target = "";
    link.dataset.browseLinkRouting = "off"; fireEvent.click(link); delete link.dataset.browseLinkRouting;
    expect(bubbled).toBe(7);
    expect(slot.inspection.rpcCalls.filter(c => c.method === "open-link")).toHaveLength(0);
    slot.lifecycle.unmount(); fireEvent.click(link); expect(bubbled).toBe(8);
  } finally { link.remove(); }
});

it("opens typed addresses on the thread host and rejects credential-bearing URLs", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thread_one", params: {} }, {
    openThreadPanel: () => true,
    rpc: { list: () => [], "open-address": () => ({ session: { id: "typed", url: "https://example.com/", hostLabel: "server" } }) },
  });
  try {
    const input = slot.getByRole("textbox", { name: "Website address" });
    fireEvent.change(input, { target: { value: "https://user:secret@example.com" } });
    fireEvent.submit(input.closest("form")!);
    await slot.findByRole("alert");
    expect(slot.inspection.rpcCalls.filter(c => c.method === "open-address")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(c => c.method === "open-address")).toHaveLength(1));
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    expect(slot.inspection.rpcCalls.find(c => c.method === "open-address")?.input).toEqual({ threadId: "thread_one", paramsJson: "{}", url: "https://example.com/" });
  } finally { slot.lifecycle.unmount(); }
});

it("redirects original launcher clicks and keyboard selection without invoking core", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(app.threadHeaderActions[0]!, { threadId: "thread_one", projectId: "project_one", isCompactViewport: false }, {
    context: { threadId: "thread_one" }, openThreadPanel: () => true, rpc: { list: () => [] },
  });
  const button = document.createElement("button"); button.id = "file-search-result-open-browser";
  const input = document.createElement("input"); input.setAttribute("aria-activedescendant", button.id);
  document.body.append(button, input);
  let coreCalls = 0;
  button.addEventListener("click", () => coreCalls++);
  input.addEventListener("keydown", () => coreCalls++);
  try {
    fireEvent.click(button);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(coreCalls).toBe(0);
    expect(slot.inspection.navigateCalls).toHaveLength(2);
    slot.lifecycle.unmount();
    fireEvent.click(button);
    expect(coreCalls).toBe(1);
  } finally { button.remove(); input.remove(); }
});

it("separates this thread's active sessions and recent pages from local web servers", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thread_one", params: {} }, {
    rpc: {
      list: () => [
        { id: "active", threadId: "thread_one", status: "ready", url: "https://active.example", hostLabel: "server" },
        { id: "closed", threadId: "thread_one", status: "released", url: "https://recent.example", hostLabel: "server" },
        { id: "duplicate", threadId: "thread_one", status: "released", url: "https://recent.example", hostLabel: "server" },
        { id: "foreign", threadId: "thread_two", status: "ready", url: "https://other.example", hostLabel: "server" },
      ],
      "local-servers": () => ({ servers: [{ port: 5173, name: "node", url: "http://localhost:5173" }], error: null }),
    },
  });
  try {
    await slot.findByText("active.example");
    expect(document.querySelector("[data-browser-shell]")?.className).toContain(
      "bg-sidebar",
    );
    expect(within(slot.getByRole("region", { name: "Open sessions" })).queryByText("recent.example")).toBeNull();
    expect(within(slot.getByRole("region", { name: "Recently visited" })).getAllByRole("button")).toHaveLength(1);
    expect(slot.queryByText("other.example")).toBeNull();
    expect(within(slot.getByRole("region", { name: "Local servers" })).getByText("localhost:5173")).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});

it("shows page loading immediately while navigation is still pending", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let finish!: (value: any) => void;
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thread_one", params: {} }, {
    rpc: { list: () => [], "local-servers": () => ({ servers: [], error: "Local server discovery is unavailable." }), "open-address": () => new Promise(resolve => { finish = resolve; }) },
  });
  try {
    const input = slot.getByRole("textbox", { name: "Website address" });
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form")!);
    expect(slot.getByRole("status", { name: "Loading page" })).toBeTruthy();
    expect(slot.queryByText("Local server discovery is unavailable.")).toBeNull();
    await waitFor(() => expect(finish).toBeTruthy());
    finish({ session: { id: "loading" } });
  } finally { slot.lifecycle.unmount(); }
});

it("reopens a closed browser in place and shows the loading frame immediately", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let finish!: (value: any) => void;
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thread_one", params: { id: "closed" } }, {
    rpc: { list: () => [{ id: "closed", threadId: "thread_one", status: "released", url: "https://example.com/" }], "open-address": () => new Promise(resolve => { finish = resolve; }) },
  });
  try {
    fireEvent.click(await slot.findByRole("button", { name: "Reopen page" }));
    expect(slot.getByRole("status", { name: "Loading page" })).toBeTruthy();
    expect(slot.queryByText("Opening…")).toBeNull();
    await waitFor(() => expect(finish).toBeTruthy());
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    expect(slot.inspection.rpcCalls.find(c => c.method === "open-address")?.input).toEqual({ threadId: "thread_one", url: "https://example.com/", sessionId: "closed", paramsJson: '{"id":"closed"}' });
    finish({ session: { id: "reopened" } });
  } finally { slot.lifecycle.unmount(); }
});
it("does not leave a removed browser session on an infinite loading frame", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(app.threadPanelActions[0]!, {
    threadId: "thread_one",
    params: { id: "missing", url: "https://example.com/" },
  }, { rpc: { list: () => [] } });
  try {
    expect(await slot.findByText("Browser closed")).toBeTruthy();
    expect(slot.queryByTitle("Live browser")).toBeNull();
    expect(slot.getByRole("button", { name: "Reopen page" })).toBeTruthy();
  } finally { slot.lifecycle.unmount(); }
});
it('sends Command-click to the client desktop and routes same-origin viewer links to their session', async () => {
 const external: string[]=[];
 (window as any).bbDesktop={openExternalUrl:(url:string)=>external.push(url)};
 const app=await loadPluginApp(()=>import('../app'));
 const slot=renderSlot(app.threadHeaderActions[0]!,{threadId:'thread_one',projectId:'project_one',isCompactViewport:false},{context:{threadId:'thread_one'},openThreadPanel:()=>true,rpc:{list:()=>[], 'open-link':()=>({session:{id:'existing',url:'https://jackfir.com/'}})}});
 const link=document.createElement('a');document.body.append(link);
 try {
  link.href='https://jackfir.com/';fireEvent.click(link,{metaKey:true});expect(external).toEqual(['https://jackfir.com/']);
  expect(slot.inspection.rpcCalls.filter(c=>c.method==='open-link')).toHaveLength(0);
  link.href='/api/v1/plugins/browse/http/viewer?id=existing';fireEvent.click(link);
  await waitFor(()=>expect(slot.inspection.rpcCalls.some(c=>c.method==='open-link'&&(c.input as any).viewerId==='existing')).toBe(true));
 } finally {slot.lifecycle.unmount();link.remove();delete (window as any).bbDesktop;}
});
