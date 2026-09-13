// This module is served only by the separate disposable demo entrypoint.
// Real enrollment still requires an actual user-verified WebAuthn ceremony.
let enrolling = false;
const prepare = async () => {
  const input = document.querySelector<HTMLInputElement>("#bootstrap");
  if (!input || enrolling || input.value) return;
  enrolling = true;
  try {
    const response = await fetch("/demo/enrollment");
    if (!response.ok) return;
    const { bootstrap } = await response.json();
    input.value = bootstrap;
    input.type = "hidden";
    document.querySelector('label[for="bootstrap"]')?.remove();
    for (const p of document.querySelectorAll("p"))
      if (p.textContent?.includes("bootstrap.txt")) p.remove();
  } finally {
    enrolling = false;
  }
};
new MutationObserver(() => void prepare()).observe(
  document.getElementById("app")!,
  { childList: true, subtree: true },
);
void prepare();
document.getElementById("demo-request")!.addEventListener("click", async () => {
  const button = document.getElementById("demo-request") as HTMLButtonElement,
    message = document.getElementById("demo-message")!;
  button.disabled = true;
  try {
    const response = await fetch("/demo/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error);
    location.hash = "request=" + body.request.id;
    location.reload();
  } catch (e) {
    message.textContent =
      e instanceof Error ? e.message : "Could not start the test.";
  } finally {
    button.disabled = false;
  }
});
