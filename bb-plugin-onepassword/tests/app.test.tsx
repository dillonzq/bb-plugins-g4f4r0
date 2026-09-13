// @vitest-environment jsdom
import { expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
it("renders onboarding without a secret entry field", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        state: () => ({
          configured: false,
          available: false,
          connected: false,
          enrolled: false,
          approvalOrigin: null,
          error: null,
          mappings: [],
          requests: [],
        }),
      },
    },
  );
  try {
    expect(await slot.findByText("Connect your approval service")).toBeTruthy();
    expect(slot.queryByLabelText("Service account token")).toBeNull();
  } finally {
    slot.lifecycle.unmount();
  }
});
