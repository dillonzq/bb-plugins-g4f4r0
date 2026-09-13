import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("enrolls, unlocks, approves once, rejects replay and missing user verification", async ({
  page,
  context,
  request,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your approval key." }),
  ).toBeVisible();
  await page.getByLabel("Service enrollment code").fill("test-enrollment-code");
  await page.getByRole("button", { name: "Create approval passkey" }).click();
  await expect(
    page.getByRole("button", { name: "Unlock with passkey" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re in control." }),
  ).toBeVisible();
  const input = () => ({
    mappingId: "approval-test",
    projectId: "test-project",
    threadId: "test-thread",
    reason: "Verify the passkey approval experience",
    idempotencyKey: randomUUID(),
  });
  const created = await request.post("/v1/requests", {
    headers: { Authorization: "Bearer test-client-token" },
    data: input(),
  });
  expect(created.status()).toBe(201);
  const { request: r } = await created.json();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Try passkey approval" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({
    path: "test-results/pending-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/pending-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  let proof: unknown;
  page.on("request", (req) => {
    if (req.url().endsWith("/" + r.id + "/approve")) proof = req.postDataJSON();
  });
  await page.getByRole("button", { name: "Approve with passkey" }).click();
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible();
  expect(proof).toBeTruthy();
  const replay = await page.evaluate(
    async ({ id, body }) => {
      const res = await fetch("/owner/requests/" + id + "/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.status;
    },
    { id: r.id, body: proof },
  );
  expect(replay).toBe(400);
  const created2 = await request.post("/v1/requests", {
    headers: { Authorization: "Bearer test-client-token" },
    data: input(),
  });
  const { request: r2 } = await created2.json();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await cdp.send("WebAuthn.setUserVerified", {
    authenticatorId,
    isUserVerified: false,
  });
  await page.getByRole("button", { name: "Approve with passkey" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const current = await request.get("/v1/requests", {
    headers: { Authorization: "Bearer test-client-token" },
  });
  expect(
    (await current.json()).requests.find((x: any) => x.id === r2.id).status,
  ).toBe("pending");
  await cdp.send("WebAuthn.setUserVerified", {
    authenticatorId,
    isUserVerified: true,
  });
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.getByText("denied", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/approval-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "test-results/approval-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Service account token")
    .fill("dummy-test-token-for-account");
  await page.getByRole("button", { name: "Connect with passkey" }).click();
  await expect(page.getByText("Configured", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlock with passkey" }),
  ).toBeVisible();
  expect(
    (
      await request.post("/auth/register/options", {
        headers: { Origin: "http://localhost:43819" },
        data: { bootstrap: "test-enrollment-code" },
      })
    ).status(),
  ).toBe(403);
});
