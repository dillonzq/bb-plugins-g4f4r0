import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  rpcContract,
  requestInput,
  browserAction,
  type State,
} from "./src/contracts";
import { ServiceClient, serviceOrigin } from "./src/client";
export { rpcContract } from "./src/contracts";
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    approvalOrigin: {
      type: "string",
      label: "Approval service HTTPS origin",
      description:
        "Your independently hosted approval service, for example https://approve.example.com.",
      default: "",
    },
    clientToken: {
      type: "string",
      label: "BB request token",
      description:
        "The request-only token from client-token.txt. Never enter a 1Password service account token here.",
      secret: true,
      default: "",
    },
  });
  const client = async () => {
    const s = await settings.get();
    if (!s.approvalOrigin || !s.clientToken)
      throw Error(
        "Configure the approval service and BB request token in plugin settings.",
      );
    return new ServiceClient(serviceOrigin(s.approvalOrigin), s.clientToken);
  };
  async function state(): Promise<State> {
    const s = await settings.get();
    const empty: State = {
      configured: !!s.approvalOrigin && !!s.clientToken,
      available: false,
      connected: false,
      enrolled: false,
      approvalOrigin: null,
      error: null,
      mappings: [],
      requests: [],
    };
    if (!empty.configured) return empty;
    try {
      return await (await client()).state();
    } catch (e) {
      return {
        ...empty,
        error: e instanceof Error ? e.message : "Approval service unavailable.",
      };
    }
  }
  async function request(
    input: z.infer<typeof requestInput>,
    ctx: { projectId?: string | null; threadId?: string | null },
  ) {
    if (!ctx.projectId || !ctx.threadId)
      throw Error("Create credential requests from a BB project thread.");
    const c = await client();
    const result = await c.call("/v1/requests", {
      ...input,
      projectId: ctx.projectId,
      threadId: ctx.threadId,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
    });
    bb.realtime.publish("requests-changed", {});
    return result;
  }
  async function cancel(id: string) {
    const result = await (
      await client()
    ).call("/v1/requests/" + encodeURIComponent(id) + "/cancel", {});
    bb.realtime.publish("requests-changed", {});
    return result;
  }
  async function inThread(
    id: string,
    ctx: { projectId?: string | null; threadId?: string | null },
  ) {
    if (!ctx.projectId || !ctx.threadId)
      throw Error("Use this command from the originating thread.");
    const c = await client(),
      data = await c.call("/v1/requests/" + encodeURIComponent(id));
    if (
      ![data.request].some(
        (r: any) =>
          r.id === id &&
          r.threadId === ctx.threadId &&
          r.projectId === ctx.projectId,
      )
    )
      throw Error("Request does not belong to this thread.");
    return c;
  }
  bb.rpc.register(rpcContract, { state, cancel: ({ id }) => cancel(id) });
  bb.agents.registerTool({
    name: "onepassword_request",
    description:
      "Request an approved credential mapping for the current project and thread. Returns an approval link; never returns passwords. The user approves on their separate service using a passkey.",
    parameters: requestInput,
    execute: async (input, ctx) => JSON.stringify(await request(input, ctx)),
  });
  bb.agents.registerTool({
    name: "onepassword_status",
    description:
      "List configured credential mappings and request states. No vault secrets are returned.",
    parameters: z.object({}),
    execute: async (_, ctx) => {
      const s = await state();
      return JSON.stringify({
        ...s,
        mappings: s.mappings.filter(
          (m) => ctx.projectId && m.projectIds.includes(ctx.projectId),
        ),
        requests: s.requests.filter((r) => r.threadId === ctx.threadId),
      });
    },
  });
  bb.agents.registerTool({
    name: "onepassword_result",
    description:
      "Read the result of a credential request in this thread, including bounded program output when the worker administrator enabled it.",
    parameters: z.object({ requestId: z.string().uuid() }),
    execute: async ({ requestId }, ctx) => {
      const c = await inThread(requestId, ctx);
      return JSON.stringify(await c.call("/v1/requests/" + requestId));
    },
  });
  bb.agents.registerTool({
    name: "onepassword_cancel",
    description:
      "Cancel a credential request or revoke its running session in this thread.",
    parameters: z.object({ requestId: z.string().uuid() }),
    execute: async ({ requestId }, ctx) => {
      await inThread(requestId, ctx);
      return JSON.stringify(await cancel(requestId));
    },
  });
  bb.agents.registerTool({
    name: "onepassword_browser",
    description:
      "Use a passkey-approved protected browser session. Supports named controls only. Never put passwords, tokens, or TOTP codes in value. Read status after an action to get its result.",
    parameters: browserAction.extend({
      kind: z.enum(["status", "inspect", "click", "fill", "navigate", "close"]),
    }),
    execute: async ({ requestId, kind, ...input }, ctx) => {
      const c = await inThread(requestId, ctx);
      return JSON.stringify(
        await c.call(
          "/v1/browser/" + requestId + (kind === "status" ? "" : "/actions"),
          kind === "status" ? undefined : { kind, ...input },
        ),
      );
    },
  });
  const usage =
    "bb onepassword status | mappings | requests | request <mapping> <reason> [--url <https-url>] [--key <uuid>] | result <request-id> | cancel <request-id> | browser <request-id> <status|inspect|close|click|fill|navigate> [control-or-url] [text] [--json]";
  bb.cli.register({
    name: "onepassword",
    summary: "Request 1Password credentials with user passkey approval",
    commands: [
      {
        name: "result",
        summary: "Read a request result and permitted output",
        usage: "bb onepassword result <request-id> [--json]",
      },
      {
        name: "status",
        summary: "Show connection and enrollment status",
        usage: "bb onepassword status [--json]",
      },
      {
        name: "mappings",
        summary: "List mappings available to this project",
        usage: "bb onepassword mappings [--json]",
      },
      {
        name: "requests",
        summary: "List requests in this thread",
        usage: "bb onepassword requests [--json]",
      },
      {
        name: "request",
        summary: "Request a named credential action",
        usage:
          "bb onepassword request <mapping> <reason> [--url <url>] [--key <uuid>] [--json]",
      },
      {
        name: "cancel",
        summary: "Cancel a request or running session",
        usage: "bb onepassword cancel <request-id> [--json]",
      },
      {
        name: "browser",
        summary: "Use named controls in an approved browser session",
        usage:
          "bb onepassword browser <request-id> <status|inspect|close|click|fill|navigate> [control-or-url] [text] [--json]",
      },
    ],
    async run(argv, ctx) {
      try {
        const args = argv.filter((a) => a !== "--json"),
          command = args.shift();
        let result: unknown;
        if (!command || ["help", "--help"].includes(command))
          return { exitCode: 0, stdout: usage };
        if (["status", "mappings", "requests"].includes(command)) {
          const s = await state();
          result =
            command === "mappings"
              ? s.mappings.filter(
                  (m) => ctx.projectId && m.projectIds.includes(ctx.projectId),
                )
              : command === "requests"
                ? s.requests.filter((r) => r.threadId === ctx.threadId)
                : s;
        } else if (command === "request") {
          const mappingId = args.shift(),
            reason = args.shift();
          let url: string | undefined, idempotencyKey: string | undefined;
          while (args.length) {
            const flag = args.shift(),
              value = args.shift();
            if (flag === "--url" && value) url = value;
            else if (flag === "--key" && value) idempotencyKey = value;
            else throw Error(usage);
          }
          result = await request(
            requestInput.parse({ mappingId, reason, url, idempotencyKey }),
            ctx,
          );
        } else if (command === "result") {
          const id = z.string().uuid().parse(args[0]),
            c = await inThread(id, ctx);
          result = await c.call("/v1/requests/" + id);
        } else if (command === "cancel") {
          const id = z.string().uuid().parse(args[0]);
          await inThread(id, ctx);
          result = await cancel(id);
        } else if (command === "browser") {
          const [id, kind, target, value] = args;
          const requestId = z.string().uuid().parse(id),
            c = await inThread(requestId, ctx);
          if (kind === "status")
            result = await c.call("/v1/browser/" + requestId);
          else {
            const input = browserAction.parse({
              requestId,
              kind,
              ...(kind === "navigate" ? { url: target } : { control: target }),
              value,
            });
            const { requestId: _, ...body } = input;
            result = await c.call(
              "/v1/browser/" + requestId + "/actions",
              body,
            );
          }
        } else throw Error(usage);
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            result,
            null,
            argv.includes("--json") ? undefined : 2,
          ),
        };
      } catch (e) {
        return {
          exitCode: 1,
          stderr:
            e instanceof z.ZodError
              ? "Invalid arguments. " + usage
              : e instanceof Error
                ? e.message
                : "1Password request failed.",
        };
      }
    },
  });
}
