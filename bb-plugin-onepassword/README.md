# 1Password for BB

A community plugin for using 1Password credentials in remote BB, with approval from a passkey saved in 1Password.

**Status: 0.1.0-alpha.1 — development preview.** The local approval and worker tests use dummy credentials. A live 1Password account, production deployment, device compatibility, and independent security review remain release gates. This project is not affiliated with or endorsed by 1Password.

The plugin provides a BB dashboard, agent tools, and `bb onepassword` commands. A separately hosted approval service verifies your passkey and resolves selected credentials through the official 1Password SDK. A protected worker runs a fixed environment command or a browser session with named controls. BB receives request status and permitted output, not a password-retrieval tool.

Your passkey authorizes **this service**. It is not a native 1Password prompt approving a vault read. The service uses a restricted 1Password service account. Sync the service's passkey through 1Password to use it on supported devices; universal cross-device compatibility has not been established.

## Start here

1. Read [deployment](docs/DEPLOYMENT.md) and the [security model](SECURITY.md).
2. Deploy `service/` outside your BB agent's administrative access.
3. Enroll your approval passkey on that service's HTTPS origin.
4. Install this plugin and set its approval origin and **BB request token** in BB Settings → Plugins → 1Password.
5. Try `verify-approval`, a mapping that accesses no credentials.
6. Configure a restricted service account and a worker mapping on the approval service.

```sh
bb onepassword mappings --json
bb onepassword request verify-approval "Try passkey approval" --json
bb onepassword requests --json
bb onepassword result <request-id> --json
```

For browser work, request an allowed URL and use the named controls returned by the session:

```sh
bb onepassword request staging-login "Check the staging dashboard" --url https://staging.example.com/login --json
bb onepassword browser <request-id> status --json
bb onepassword browser <request-id> inspect --json
bb onepassword browser <request-id> close --json
```

Browser actions are asynchronous. Read `status` after each action. Requests expire after five minutes if unused. A worker action has its own approved duration, at most one hour. Cancel or revoke an active request to stop the worker. Stopping a process or closing a browser does not revoke the underlying credential at its issuer.

## Components

| Component | Holds | Runs where |
| --- | --- | --- |
| BB plugin | A request-only client token; request metadata | Your BB server |
| Approval service | Encrypted service account token; passkey public key; request policy | Trusted HTTPS host outside agent administration |
| Browser worker | Its scoped worker token; temporary selected values; browser session | Protected non-root Linux account with sandboxed Chromium |
| Command worker | Its scoped worker token; temporary selected values | Protected Linux host; root supervisor launches commands as a separate unprivileged UID |
| Your device | Your approval passkey, preferably synced with 1Password | Supported browser and password manager |

Command profiles pin an executable, arguments, working directory, execution UID/GID, and output policy. Their configuration digest is part of the approval mapping. **The program receiving an environment variable can read and disclose it.** Use trusted programs and constrain their filesystem and network access. This preview is not a sandbox for hostile code.

Browser profiles pin login selectors, allowed origins, and a small set of text/click/fill controls. There is no raw JavaScript, screenshot, CDP, cookie export, or observation during credential entry. TOTP codes are resolved just before entry and can be requested only once per approved login. Failed login closes the browser; a new request needs a new approval.

## Development

Use Node 24, BB >=0.43, and the pinned SDK. Both packages have lockfiles.

```sh
npm ci
npm ci --prefix service
npm run check
bb plugin build
npx playwright install chromium
npm run test:e2e
```

Alternatively, point `ONEPASSWORD_TEST_CHROME` to an installed Chrome for Testing executable. The protected worker browser test enables Chromium's sandbox and requires an OS that supports it. Tests create temporary loopback-only services and virtual test authenticators. They do not contact a real 1Password account.

See [validation](docs/VALIDATION.md), [privacy](PRIVACY.md), and the [release checklist](docs/RELEASE.md). The service has no analytics or telemetry added by this project. SDK and destination services have their own behavior and terms.

## Sources

The implementation uses the [official 1Password SDK](https://www.1password.dev/sdks), [service accounts](https://www.1password.dev/service-accounts/get-started), [Environments API](https://www.1password.dev/environments/read-environment-variables), and [TOTP secret references](https://www.1password.dev/sdks/concepts). Passkey ceremonies use [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server).
