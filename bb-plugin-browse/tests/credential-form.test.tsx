// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
it("submits native autofill values without React change events and clears the form", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let received: unknown;
  const submit = vi.fn(async (values) => {
    received = structuredClone(values);
  });
  const slot = renderSlot(
    app.pendingInteractions[0]!,
    {
      interaction: {
        id: "request-one",
        threadId: "thread-one",
        title: "Login",
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000,
        payload: {
          origin: "https://accounts.shopify.com",
          purpose: "Test login",
          fields: [
            { label: "Email", kind: "username" },
            { label: "Password", kind: "password" },
          ],
        },
      },
      submit,
      cancel: async () => {},
    },
    {},
  );
  try {
    const email = slot.getByLabelText("Email") as HTMLInputElement,
      password = slot.getByLabelText("Password") as HTMLInputElement;
    expect(password.autocomplete).toBe("current-password");
    expect(password.type).toBe("password");
    email.value = "dummy-user";
    password.value = "dummy-password";
    fireEvent.submit(password.form!);
    await waitFor(() =>
      expect(received).toEqual(["dummy-user", "dummy-password"]),
    );
    await waitFor(() => expect(password.value).toBe(""));
    expect(submit).toHaveBeenCalledTimes(1);
  } finally {
    slot.lifecycle.unmount();
  }
});
