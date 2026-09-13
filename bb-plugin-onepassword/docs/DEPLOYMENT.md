# Deployment

This preview separates BB from the credential service. Do not put the service's database, encryption key, account token, worker tokens, or administration credentials on a host the BB agent can administer. An unrestricted agent running as the same OS user can bypass an in-process approval prompt. A container controlled by that agent does not create the required boundary.

The supplied service targets Node 24 on Linux. Browser clients need HTTPS and WebAuthn. Use an origin you control permanently: passkeys are bound to its hostname. A phone may use a synced passkey or a browser's cross-device ceremony; verify your actual devices before relying on it.

## 1. Approval service

On the trusted host, obtain a reviewed source revision and install only the service package:

```sh
cd service
npm ci
npm run check
npm run build
node dist/init.js /private/onepassword-data https://approve.example.com your-bb-project-id
node dist/main.js /private/onepassword-data/config.json
```

Run initialization as the dedicated service user. The new directory is private (0700); files are 0600. Initialization refuses to overwrite an existing directory. The generated files are:

| File | Purpose |
| --- | --- |
| `config.json` | Exact public origin, listener, allowed client projects, worker identities, token hashes |
| `master.key` | AES-256-GCM encryption key; protect separately from database backups |
| `onepassword.sqlite` | Encrypted account token, public passkey, mappings, request metadata, audit |
| `bootstrap.txt` | One-time first-owner enrollment code |
| `client-token.txt` | Request-only BB token; this is the only generated token to copy into BB |
| `worker-token.txt` | Scoped protected-worker authentication |

Terminate TLS with your trusted reverse proxy. Proxy the exact origin to `127.0.0.1:43810`. Do not rewrite `Origin`, cache responses, add third-party scripts, or log authorization headers, cookies, or request/response bodies. Restrict the listener to loopback or a private service network. A typical Caddy site is:

```caddyfile
approve.example.com {
  reverse_proxy 127.0.0.1:43810
}
```

Use an actual domain you control, DNS pointing at the trusted host, and your proxy's normal certificate provisioning. Configure service supervision with automatic restart. Run the broker as its dedicated non-root account with only its private data directory writable. Do not run the loopback test server from `scripts/` in production.

Open the HTTPS origin on your device. Enter the enrollment code from the trusted host console and save the new approval passkey in 1Password. The application cannot force which passkey manager your OS chooses; select 1Password in the browser or system prompt. Enrollment becomes unavailable after the first credential is registered. Securely remove `bootstrap.txt` after enrollment.

Unlock the site with that passkey. Sessions expire after 15 minutes, and each approval or configuration change requires a new passkey ceremony with user verification. Denial, revocation, and logout require the authenticated owner session. Challenges are single-use and expire after five minutes.

## 2. BB connection and trial

Install the BB plugin from the permanent reviewed source. In Settings → Plugins → 1Password, enter the service's exact HTTPS origin with no trailing slash, and the value of `client-token.txt`. Settings take effect without a plugin reinstall. Do not put a 1Password service account token in BB.

From the allowed project thread:

```sh
bb onepassword request verify-approval "Test approval from my device" --json
```

Open the returned link. Verify the project, thread, purpose, and expiry, then approve. The result should be `succeeded`, with no credential access. Repeat this on every device/browser combination you plan to use.

## 3. Restricted 1Password access

Create a dedicated automation vault. Create a 1Password service account with read-only access to that vault and only the Environments you need. Follow the [official service-account setup](https://www.1password.dev/service-accounts/get-started). Availability and restrictions depend on the account and plan; verify them in your account. This plugin does not grant access to Personal/Private/Employee vaults or provide a personal-vault login flow.

On the approval site, open Settings and enter the token directly into **Service account token**. Approve the configuration change with your passkey. “Configured” means stored, not that the provider has been successfully contacted. The first real worker request verifies actual credential access. The token is encrypted at rest, and the service never returns it to BB or workers.

Use `op://` references copied from 1Password. Prefer immutable vault/item/field IDs when practical. For TOTP, the reference must end with `?attribute=otp` or `?attribute=totp`; the seed is never needed by the worker. [Reference syntax](https://www.1password.dev/cli/secret-reference-syntax).

## 4. Protected workers

Workers connect outbound over HTTPS and authenticate with their own token. Each claims only approvals for its configured worker ID. Provision distinct worker IDs and random token hashes in `config.json` for distinct execution identities. Restart the service after changing this file; outstanding uncertain executions are marked failed rather than replayed.

Store each worker's token file with mode 0600 in a private directory accessible only to its supervisor. Its configuration, executable, and profile files must not be writable by the BB agent or the job user.

### Environment commands

The command worker supervisor runs as root on the isolated worker host and drops the child to the configured non-root UID/GID. This keeps its token outside the job user's file and process access. Use a dedicated job account, private workspace, reviewed code, restricted network egress, and OS-level cgroup/container controls for resource limits. Avoid unrelated workloads on this host. This preview's process-group cancellation is not containment for a malicious program that deliberately escapes its process group.

Example `worker.json` (replace paths and account IDs):

```json
{
  "origin": "https://approve.example.com",
  "tokenFile": "/private/worker/token.txt",
  "profiles": {
    "staging-check": {
      "kind": "environment",
      "executable": "/usr/bin/node",
      "args": ["/srv/reviewed-app/check.mjs"],
      "cwd": "/srv/reviewed-app",
      "uid": 1001,
      "gid": 1001,
      "baseEnv": {"NODE_ENV": "staging"},
      "returnOutput": false
    }
  }
}
```

Commands do not inherit the supervisor's environment. Mapped variables cannot override `OP_*`, loader/runtime injection variables, PATH, HOME, SHELL, or shell startup settings. Administratively configured `baseEnv` is trusted. Arguments never contain resolved credentials.

Generate the profile digest, then start the worker:

```sh
node dist/fingerprint.js /private/worker/worker.json
node dist/worker.js /private/worker/worker.json
```

Create a mapping on the approval site. Use the digest printed for this profile:

```json
{
  "id": "staging-check",
  "label": "Check staging API",
  "kind": "environment",
  "projectIds": ["your-bb-project-id"],
  "workerId": "worker",
  "profile": "staging-check",
  "profileDigest": "REPLACE_WITH_64_CHARACTER_SHA256",
  "fields": {"API_KEY": "op://automation/staging/api-key"},
  "maxSeconds": 120
}
```

For an Environment instead of individual fields, use `environmentId` and an explicit `variables` list. Only selected names are delivered. If both sources provide the same name, the explicit field reference takes precedence. The SDK's Environment access uses a service account scoped to that Environment. [Official guide](https://www.1password.dev/environments/read-environment-variables).

Output is withheld by default. Enabling `returnOutput` returns at most 32 KiB, with exact selected values and common URL/base64 encodings masked. Transformed, fragmented, or newly generated secrets can evade masking. Treat returned program output as deliberate disclosure to BB and its model provider.

### Protected browser

Use a separate **non-root** worker account and sandbox-capable Chromium. This worker will not run as root and never falls back to `--no-sandbox`. Install Chromium and its OS dependencies on that host. No debug port or profile directory is exposed to BB.

```json
{
  "origin": "https://approve.example.com",
  "tokenFile": "/private/browser-worker/token.txt",
  "profiles": {
    "staging-login": {
      "kind": "browser",
      "executable": "/usr/bin/chromium",
      "origins": ["https://staging.example.com"],
      "resourceOrigins": [],
      "username": "input[name=email]",
      "password": "input[name=password]",
      "submit": "button[type=submit]",
      "success": "[data-testid=dashboard]",
      "controls": {
        "summary": {"kind":"text","selector":"[data-testid=summary]"},
        "search": {"kind":"fill","selector":"input[name=search]"},
        "search-submit": {"kind":"click","selector":"button[data-action=search]"}
      }
    }
  }
}
```

The corresponding mapping has `kind: "browser"`, matching `profile`, `profileDigest`, and `workerId`, allowed `origins`, and `fields.USERNAME`/`fields.PASSWORD`. Optional `fields.TOTP` pairs with worker selectors `totp` and optionally `totpSubmit`.

Navigation, popups, downloads, service workers, and WebSockets are constrained. Only approved navigation origins and explicitly configured resource origins can load. Include necessary SSO origins only after review. Login forms with unusual flows, CAPTCHA, passkey-only websites, or multi-step usernames are not supported by the initial fixed login sequence; do not weaken origin checks to make them work. This session is separate from Browse's unrestricted browser controller.

Text output is limited to configured selectors. Configure these narrowly: everything they reveal goes to BB. Click and fill are limited to named controls. Do not expose credential fields as controls. Session cookies remain in a fresh temporary context; expiry or cancellation closes it. Closing a browser does not revoke a server-issued login token at the destination.

## Rotation, recovery, and updates

- Replace or disconnect the account token on the approval site with passkey verification. Both replacing and disconnecting the token cancel pending and active requests. Revoke the original token in 1Password when retiring it.
- Rotate a client or worker token by provisioning a new random token and SHA-256 hash on the trusted host, changing its configuration, and restarting the affected service. Never paste these into an agent chat.
- Keep the service database and master key in separate protected backup locations. Restoring the pair restores credentials and passkey registration. This package does not configure backups for you.
- A synced passkey can survive device loss. If all copies are lost, there is no BB reset endpoint. Trusted administration must stop the service, revoke the account token, and initialize a fresh data directory and owner registration. Reconfigure reviewed mappings. Do not edit out authentication checks.
- Stop workers before service upgrades. An interrupted running action has an uncertain external outcome; inspect the destination before submitting another request. Never retry a mutation automatically after a network failure.
- Removing the BB plugin does not delete the independently deployed service or revoke its 1Password account token. Decommission those explicitly on the trusted host.
