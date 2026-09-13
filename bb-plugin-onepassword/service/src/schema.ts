import { z } from "zod";
export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const text = z.string().trim().min(1).max(200);
export const originSchema = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.origin === value &&
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname)))
    );
  }, "Use an exact HTTPS origin, or loopback HTTP for local development.");
export const mappingSchema = z
  .object({
    id,
    label: text,
    projectIds: z.array(id).min(1).max(50),
    workerId: id,
    kind: z.enum(["demo", "environment", "browser"]),
    profile: id,
    profileDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    environmentId: z.string().max(100).optional(),
    fields: z
      .record(
        z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/),
        z.string().startsWith("op://").max(1000),
      )
      .default({}),
    variables: z
      .array(z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/))
      .max(100)
      .default([]),
    origins: z.array(originSchema).max(20).default([]),
    maxSeconds: z.number().int().min(1).max(3600).default(300),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind !== "demo" && !m.profileDigest)
      ctx.addIssue({
        code: "custom",
        message: "Pin the worker profile digest.",
      });
    if (
      m.kind === "environment" &&
      !m.environmentId &&
      !Object.keys(m.fields).length
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose an Environment or fields.",
      });
    if (
      m.kind === "browser" &&
      (!m.origins.length || !m.fields.PASSWORD || !m.fields.USERNAME)
    )
      ctx.addIssue({
        code: "custom",
        message: "Browser mappings require origins, USERNAME, and PASSWORD.",
      });
    if (
      m.fields.TOTP &&
      !["otp", "totp"].includes(
        new URL(m.fields.TOTP).searchParams.get("attribute") ??
          new URL(m.fields.TOTP).searchParams.get("attr") ??
          "",
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "TOTP references must request attribute=otp or attribute=totp.",
      });
    if (m.environmentId && !m.variables.length)
      ctx.addIssue({
        code: "custom",
        message: "Choose the exact Environment variables to deliver.",
      });
  });
export type Mapping = z.infer<typeof mappingSchema>;
export const requestSchema = z
  .object({
    mappingId: id,
    projectId: id,
    threadId: id,
    reason: z.string().trim().min(1).max(500),
    url: z.string().url().max(2000).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type RequestInput = z.infer<typeof requestSchema>;
export const statusSchema = z.enum([
  "pending",
  "approved",
  "running",
  "succeeded",
  "failed",
  "denied",
  "expired",
  "cancelled",
]);
export type Status = z.infer<typeof statusSchema>;
export type CredentialRequest = {
  id: string;
  clientId: string;
  input: RequestInput;
  mapping: Mapping;
  status: Status;
  createdAt: number;
  expiresAt: number;
  startedAt: number | null;
  endedAt: number | null;
  result: JobResult | null;
};
export const resultSchema = z
  .object({
    ok: z.boolean(),
    summary: z.string().max(1000),
    exitCode: z.number().int().nullable(),
    output: z.string().max(32000).default(""),
    sessionId: id.optional(),
  })
  .strict();
export type JobResult = z.infer<typeof resultSchema>;
export type Delivery = {
  requestId: string;
  mapping: Mapping;
  input: RequestInput;
  values: Record<string, string>;
  deadline: number;
};
export const clientSchema = z
  .object({
    id,
    label: text,
    tokenHash: z.string().length(64),
    projectIds: z.array(id).min(1),
  })
  .strict();
export const workerSchema = z
  .object({ id, label: text, tokenHash: z.string().length(64) })
  .strict();
export const configSchema = z
  .object({
    origin: z.string().url(),
    listen: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(43810),
    dataDir: z.string().min(1),
    keyFile: z.string().min(1),
    bootstrapHash: z.string().length(64),
    clients: z.array(clientSchema).max(50),
    workers: z.array(workerSchema).max(50),
    allowLocalHttp: z.boolean().default(false),
  })
  .strict()
  .superRefine((c, ctx) => {
    const u = new URL(c.origin);
    if (u.origin !== c.origin || u.username || u.password)
      ctx.addIssue({
        code: "custom",
        message: "Origin must be an exact origin without path or credentials.",
      });
    if (
      u.protocol !== "https:" &&
      !(
        c.allowLocalHttp &&
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "HTTPS is required except explicit loopback development.",
      });
  });
export type Config = z.infer<typeof configSchema>;
export function publicRequest(r: CredentialRequest, includeOutput = false) {
  return {
    id: r.id,
    mappingId: r.mapping.id,
    label: r.mapping.label,
    kind: r.mapping.kind,
    workerId: r.mapping.workerId,
    profile: r.mapping.profile,
    profileDigest: r.mapping.profileDigest ?? null,
    projectId: r.input.projectId,
    threadId: r.input.threadId,
    reason: r.input.reason,
    url: r.input.url ?? null,
    variables: [
      ...new Set([
        ...(r.mapping.environmentId ? r.mapping.variables : []),
        ...Object.keys(r.mapping.fields),
      ]),
    ],
    maxSeconds: r.mapping.maxSeconds,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    result: r.result
      ? { ...r.result, output: includeOutput ? r.result.output : "" }
      : null,
  };
}
