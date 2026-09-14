# Browser credential form validation

September 14, 2026. This adds credential delivery to Browse through BB's private interaction SDK. The built-in Secrets plugin and custom 1Password preview were preserved.

Verified:

- TypeScript check and all 81 tests pass.
- Form test submits values inserted directly into native input elements without relying on React change events, matching password-manager autofill behavior; fields are cleared on submission.
- Server tests cover thread ownership, cancellation, metadata-only form payloads/results, and suppression of downstream errors containing dummy secret values.
- Real Chromium host test (`npx tsx scripts/credential-smoke.ts`) signs in to a local POST fixture using dummy credentials and verifies the resulting authenticated page. It checks rejection of repeated delivery, blocked agent/viewer input and frames during a request, rejection after document navigation, and lock release after failure/cancellation.
- DOM tests reject replaced fields, changed URLs/form destinations/submit destinations, and passwords changed to visible text inputs.

Not yet verified: physical iPhone 1Password picker, Shopify, SSO, MFA provider-specific flows, native desktop sessions, iframe/shadow-root login fields. The first implementation supports top-document standard fields and a button, HTTPS or loopback test HTTP, and same-origin POST forms.

Credentials never enter Browse's normal command argv, job output, result, or dotenv writer through this feature. They transit BB's private interaction and host RPC in memory and are delivered to the selected webpage. This is not an isolation boundary against arbitrary shell access, browser scripting, destination-page scripts, or a compromised host. Clearing the original inputs cannot erase values a website retained elsewhere. `filled:true` confirms fill/click, not authentication success.
