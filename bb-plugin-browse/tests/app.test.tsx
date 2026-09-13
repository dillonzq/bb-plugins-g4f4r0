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
    version: "0.37.1",
    installed: true,
    ffmpeg: true,
    chromeInstalled: true,
    chromeRunnable: true,
    chromePath: "/chrome",
    chromeVersion: "Chrome 153",
    launchError: null,
  };
}
it("shows every machine, probes connected hosts independently, and keeps offline hosts out of RPC checks", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.navPanels).toHaveLength(0);
  expect(app.settingsSections).toHaveLength(1);
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
                chromeRunnable: false,
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
