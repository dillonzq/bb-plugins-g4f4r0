# Validation record

Local development verification on September 13, 2026:

- Node 24.21.0, BB plugin SDK 0.4.87, Linux x64.
- Root and service TypeScript checks pass.
- 15 unit/integration tests pass across the service, worker process, BB backend, and BB frontend harness.
- Two browser end-to-end tests pass with Chrome for Testing 153.0.8010.36.
- BB production bundle and the separate service/browser bundles build successfully.
- Root and service production dependency audits reported zero known vulnerabilities at verification time. This is not a security audit.

The browser tests exercise real WebAuthn registration/assertion verification using a virtual test authenticator: required user verification, replay rejection, login, approval, denial, and passkey-gated account configuration. A separate test runs the actual protected-browser code with Chromium's sandbox enabled, logs into a loopback dummy site, uses named controls, masks dummy password text, rejects another origin, and closes the session. Mobile and desktop screenshots come from these dummy flows.

Unit/integration tests cover API client/project/worker boundaries, no resolution before approval, one-time dispatch, changed idempotency payloads, mapping invalidation, expiry, encrypted token storage, challenge binding and consumption, origin enforcement, unavailable browser sessions, environment inheritance, reserved variables, output suppression, masking, cancellation, secure broker origins, and BB's public SDK boundary.

These tests do **not** establish:

- Real 1Password vault, Environment, TOTP, plan, or account compatibility.
- Approval from a real 1Password passkey or the user's devices.
- An isolated production deployment or its backup/restore policy.
- End-to-end root-supervisor UID/GID separation on a deployed worker (process tests run with the test user's identity).
- Containment of malicious programs, browsers with exploitable vulnerabilities, or a compromised service administrator.
- Independent security review or marketplace publication readiness.

Use `npm run check` and `npm run test:e2e` to reproduce the automated checks. See README for browser prerequisites. Live installed BB status and UI verification are recorded in the installation session; the fake-host tests alone do not prove host behavior.
