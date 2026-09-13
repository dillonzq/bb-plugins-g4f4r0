import { test, expect } from "@playwright/test";
test("user can enroll, unlock, request and approve the credential-free demo", async ({
  page,
  context,
  request,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("/");
  await expect(
    page.getByText("Live passkey test · simulated Shopify login"),
  ).toBeVisible();
  await expect(page.locator("#bootstrap")).toHaveAttribute("type", "hidden");
  await page.getByRole("button", { name: "Create approval passkey" }).click();
  await expect(
    page.getByRole("button", { name: "Unlock with passkey" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re in control." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Start Shopify approval test" })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve with passkey" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve with passkey" }).click();
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible();
  const status = await (await request.get("/demo/status")).json();
  expect(status.realCredentials).toBe(false);
  expect(status.requests[0].status).toBe("succeeded");
  expect(status.requests[0].variables).toEqual([]);
  const denied = await page.evaluate(async () => {
    const response = await fetch("/owner/action/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "token",
        token: "never-accept-this-dummy-token",
      }),
    });
    return response.status;
  });
  expect(denied).toBe(403);
});
