# Community marketplace release gates

The display name is **1Password**, plugin ID **onepassword**. The first local build is `0.1.0-alpha.1`. Do not describe it as official or universally compatible.

Before a marketplace submission:

- [ ] Provision and validate an isolated HTTPS service and both worker identities.
- [ ] Validate real service-account vault fields, selected Environments, token rotation, denied account permissions, and current TOTP codes.
- [ ] Test the user's actual 1Password setup and supported mobile/desktop browser matrix, including synced and cross-device passkeys and device loss.
- [ ] Obtain independent review of the credential service, WebAuthn flows, process execution, browser boundaries, dependency/native-library packaging, and deployment instructions.
- [ ] Test clean deployment, upgrade, crash/restart, backup restoration, and uninstall/decommissioning on supported Linux hosts.
- [ ] Improve onboarding from observed device tests and establish the final support policy.
- [ ] Verify naming, branding, third-party notices, SDK distribution terms, and current marketplace schema.
- [ ] Select the public repository, author identity, security contact, license/copyright attribution, and support links.
- [ ] Publish a reviewed source revision and immutable release tag, with exact user approval for repository/account/version/commit.
- [ ] Capture marketplace screenshots at its current size limits and complete the marketplace entry/PR.

Prepared locally: source and lockfiles, MIT license template, overview, deployment/security/privacy documentation, tests, BB dashboard and agent skill. The approval UI's numeral mark is original and does not reproduce the 1Password logo.

No public repository, release tag, marketplace submission, off-server backup, or independent audit is implied by this local package.
