# Security model and reporting

This is a development preview, not an independently audited credential product. Before public release, complete the gates in `docs/RELEASE.md`. Report vulnerabilities privately through the public repository's security advisory feature once that repository is established. Do not open a public issue containing credentials, logs, or exploit details against a live deployment.

## Trust boundaries

The BB agent and its tools may request actions but cannot approve them through the client API. Approval requires a registered WebAuthn credential, user verification, a matching RP ID and exact origin, and a single-use challenge bound to the request. Administrative writes have challenges bound to the normalized full action payload. Owner cookies are HttpOnly, SameSite=Strict, and Secure over HTTPS. Owner mutations enforce the exact Origin. Enrollment requires a random bootstrap code and is disabled after the first credential.

These guarantees depend on the approval service, its HTTPS origin, dependencies, administrator, encryption key, OS, and user device remaining trusted. An agent with service-host administrative access can replace the code or read its token; WebAuthn does not protect against that. A hostile browser extension or compromised device is outside this model.

The account token is AES-256-GCM encrypted with a random nonce. Its encryption key is a separate private file. A disk image containing both defeats that at-rest protection. Worker and client tokens are stored as hashes on the broker. Raw worker tokens stay on their worker; the BB token is request-only and constrained to configured projects. Project and thread IDs are useful context but are not a second authentication factor against a compromised client token.

Mappings are snapshotted into requests. A configuration digest pins each worker profile; changing a mapping cancels its unused requests. Transactional state changes allow only one claim. Cancellation after dispatch cannot take back values already delivered. Workers check revocation approximately every second and stop on service connectivity loss. Running jobs are never replayed automatically after restart.

## Deliberate limits

- A program receiving environment variables can disclose them. This preview runs trusted programs, not hostile code. Separate child UID/GID protects the supervisor's token; it is not a complete filesystem or network sandbox. Use OS isolation and egress controls. Process-group termination cannot guarantee cleanup of deliberately detached descendants.
- Profile digests cover configuration, not the contents of executables or working directories. Review and protect deployed code independently. Agent-writable code receiving secrets has the same disclosure power as any other program receiving them.
- Browser text regions and optional process output are disclosures to BB. Exact-value redaction is an accidental-leak defense, not a data-loss prevention guarantee.
- Browser origins, controls, and resources are administrator-selected trust decisions. Web pages can make requests and use their own authenticated session. No general-purpose browser automation can guarantee a destination will never misuse a credential provided to it.
- Request expiry limits unused approvals. Runtime expiry limits worker operation; it does not rotate API keys or invalidate destination cookies already issued. Revoke credentials at their issuer for that.
- A BB passkey is not a 1Password vault approval mechanism. The service account has standing vault access inside the trusted broker.
- Account token replacement does not revoke the old token at 1Password. Disconnection cancels work but cannot undo completed external changes.
- This single-owner preview has no multi-user ownership, account recovery UI, hardware attestation requirement, or universal device compatibility claim. Rate limiting is a small single-process defense; deploy infrastructure-level limits for internet exposure.

## Verification

Tests cover cross-project/client/worker access, no pre-approval secret resolution, one-time claims, expiry, cancellation, encrypted token storage, challenge binding/consumption, exact origin enforcement, process environment isolation and masking, passkey enrollment and user verification, replay rejection, and protected browser actions. See `docs/VALIDATION.md` for what was actually run. Real account tests and independent review remain separate requirements.
