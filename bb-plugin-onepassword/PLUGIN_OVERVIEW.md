# 1Password

Use selected 1Password credentials from remote BB, with a passkey approval you control.

Ask your agent to run a configured command with environment variables or open an approved website. Review the project, purpose, destination, and duration on your independent approval service, then approve using a passkey saved in 1Password.

- Native BB dashboard, agent tools, and CLI.
- Restricted service-account access to selected vault fields and Environments.
- Per-request passkey verification, expiry, revocation, and audit history.
- Protected browser sessions with named controls and temporary credentials.
- Separate service and worker deployment, with documented trust boundaries.

**Development preview.** Requires your own HTTPS approval service, protected Linux workers, a suitable 1Password service account, and compatible passkey devices. Real-account and device validation and independent security review are required before production use. This is not a one-click sign-in to a personal vault or a native 1Password vault-approval prompt.

Independent community integration; not affiliated with or endorsed by 1Password.
