import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
export const requestSchema = z.object({
  id: z.string(),
  mappingId: z.string(),
  label: z.string(),
  kind: z.enum(["demo", "environment", "browser"]),
  workerId: z.string(),
  profile: z.string(),
  projectId: z.string(),
  threadId: z.string(),
  reason: z.string(),
  url: z.string().nullable(),
  variables: z.array(z.string()),
  maxSeconds: z.number(),
  status: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  result: z
    .object({
      ok: z.boolean(),
      summary: z.string(),
      exitCode: z.number().nullable(),
      output: z.string(),
      sessionId: z.string().optional(),
    })
    .nullable(),
});
export const mappingSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["demo", "environment", "browser"]),
  projectIds: z.array(z.string()),
  workerId: z.string(),
  profile: z.string(),
  variables: z.array(z.string()),
  origins: z.array(z.string()),
  maxSeconds: z.number(),
});
export const requestInput = z.object({
  mappingId: z.string().min(1).max(100),
  reason: z.string().trim().min(1).max(500),
  url: z.string().url().max(2000).optional(),
  idempotencyKey: z.string().uuid().optional(),
});
export const browserAction = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["inspect", "click", "fill", "navigate", "close"]),
  control: z.string().max(100).optional(),
  value: z.string().max(4000).optional(),
  url: z.string().url().max(2000).optional(),
});
export const stateSchema = z.object({
  configured: z.boolean(),
  available: z.boolean(),
  connected: z.boolean(),
  enrolled: z.boolean(),
  approvalOrigin: z.string().nullable(),
  error: z.string().nullable(),
  mappings: z.array(mappingSchema),
  requests: z.array(requestSchema),
});
export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateSchema },
  cancel: {
    input: z.object({ id: z.string().uuid() }),
    output: z.object({ request: requestSchema }),
  },
});
export type State = z.infer<typeof stateSchema>;
