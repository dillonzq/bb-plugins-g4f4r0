# Privacy

The plugin sends request metadata to the approval service you configure: project/thread IDs, mapping ID, purpose, target URL, and request status. Browser actions also send ordinary form text and named control IDs. Permitted browser text and optional program output return to BB and may enter the model context. Avoid entering sensitive free text unless you intend that disclosure.

The approval service stores the encrypted 1Password service account token, public passkey material, credential references, mappings, request snapshots, results, and an audit log. Passkey private keys remain with your authenticator. It never requests your 1Password account password or Secret Key. Up to 500 recent request records plus active requests are retained; audit history is limited to 2,000 events. Temporary browser/action state is removed at request termination. Owner sessions and challenges expire and are removed during service activity; restart clears them.

Selected credential values are resolved in the service and delivered to the assigned worker over HTTPS. The service does not persist those values. Workers hold them temporarily in memory and deliver them to the approved process or browser. JavaScript memory cannot provide reliable zeroization guarantees. Program output is withheld by default; enabled output is bounded and masked, with the limitations described in SECURITY.md.

This project adds no analytics service. Your reverse proxy, hosting provider, 1Password SDK, destinations, BB server, and model provider have separate data handling. Configure proxies and supervisors to avoid logging tokens, cookies, or payloads. BB retains its normal tool and conversation history; deleting service records does not delete copies already returned to BB.

Decommissioning requires revoking the account and worker/client tokens and deleting the independent service data and backups. Uninstalling the BB plugin alone does not perform those actions. You operate the service and choose its data location.
