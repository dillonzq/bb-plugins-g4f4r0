import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { credentialRequest, credentialValues } from "./credentials";
export const VERSION = "0.37.1";
export const id = z.string().min(1).max(200);
export const point = z.object({
  x: z.number().finite().min(0).max(50000),
  y: z.number().finite().min(0).max(50000),
});
export const atomicOperation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("element"),
    action: z.enum(["click", "hover", "fill"]),
    selector: z.string().min(1).max(2000),
    value: z.string().max(100000).optional(),
    waitMs: z.number().int().min(0).max(30000).default(3000),
  }),
  z.object({
    kind: z.literal("observe"),
    screenshot: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("command"),
    args: z.array(z.string().max(100000)).min(1).max(100),
  }),
  z.object({
    kind: z.literal("batch"),
    commands: z
      .array(z.array(z.string().max(100000)).min(1).max(100))
      .min(1)
      .max(100),
  }),
  z.object({
    kind: z.literal("gesture"),
    strokes: z.array(z.array(point).min(1).max(5000)).min(1).max(100),
    intervalMs: z.number().int().min(0).max(100).default(8),
  }),
  z.object({
    kind: z.literal("screenshot"),
    fullPage: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("canvas"),
    selector: z.string().min(1).max(1000).default("canvas"),
  }),
  z.object({
    kind: z.literal("record"),
    action: z.enum(["start", "stop"]),
    fps: z.number().int().min(1).max(60).default(20),
  }),
  z.object({
    kind: z.literal("download"),
    selector: z.string().min(1).max(1000),
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/),
  }),
  z.object({ kind: z.literal("pdf") }),
  z.object({
    kind: z.literal("downloadClick"),
    selector: z.string().min(1).max(2000),
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/),
  }),
]);
export const operation = z.union([
  atomicOperation,
  z.object({
    kind: z.literal("sequence"),
    steps: z.array(atomicOperation).min(1).max(50),
  }),
]);
export type Operation = z.infer<typeof operation>;
export const artifact = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  mime: z.string(),
  bytes: z.number(),
  url: z.string().optional(),
});
export type Artifact = z.infer<typeof artifact>;
export const job = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  kind: z.string(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationMs: z.number(),
  output: z.string().optional(),
  error: z.string().optional(),
  artifacts: z.array(artifact),
});
export type Job = z.infer<typeof job>;
export const hostSession = z.object({
  id: z.string(),
  status: z.enum(["connecting", "ready", "error", "released"]),
  error: z.string().optional(),
  recording: z.boolean(),
  artifactRoot: z.string(),
  targetId: z.string().optional(),
  busy: z.string().optional(),
  url: z.string().optional(),
});
export const scope = z.object({
  hostId: id,
  instanceId: id,
  generation: id,
  threadId: id,
});
export const session = hostSession.extend({
  mode: z.enum(["managed", "native"]).default("native"),
  profileId: id.optional(),
  connectJobId: id.optional(),
  viewerUrl: z.string().optional(),
  hostId: id,
  instanceId: id,
  generation: id,
  threadId: id,
  tabId: id,
  url: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  hostLabel: z.string(),
});
export type Session = z.infer<typeof session>;
export const health = z.object({
  platform: z.string(),
  arch: z.string(),
  version: z.string(),
  installed: z.boolean(),
  ffmpeg: z.boolean(),
  chromeInstalled: z.boolean(),
  chromeRunnable: z.boolean(),
  chromePath: z.string().nullable(),
  chromeVersion: z.string().nullable(),
  launchError: z.string().nullable(),
  display: z.enum(["host", "virtual", "missing"]),
  xvfb: z.boolean(),
  xkbcomp: z.boolean(),
  xkbData: z.boolean(),
});
export const viewerInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    x: z.number().min(0).max(1279),
    y: z.number().min(0).max(799),
  }),
  z.object({
    kind: z.literal("scroll"),
    deltaY: z.number().min(-1600).max(1600),
  }),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(10000) }),
  z.object({
    kind: z.literal("key"),
    key: z.enum([
      "Enter",
      "Tab",
      "Backspace",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Delete",
    ]),
  }),
  z.object({ kind: z.literal("navigate"), url: z.string().max(4000) }),
]);
export const hostContract = defineRpcContract({
  credentialPrepare: {
    input: credentialRequest,
    output: z.object({ token: z.string(), origin: z.string() }),
  },
  credentialFill: {
    input: z.object({ id, token: z.string(), values: credentialValues }),
    output: z.object({ filled: z.boolean(), count: z.number() }),
  },
  credentialCancel: {
    input: z.object({ id, token: z.string() }),
    output: z.object({ cancelled: z.boolean() }),
  },
  probe: { input: z.null(), output: health },
  setup: {
    input: z.object({ dependencies: z.boolean().default(true) }).nullable(),
    output: job,
  },
  connect: {
    input: z.object({
      id,
      endpoint: z.string().default(""),
      expiresAt: z.number(),
      mode: z.enum(["native", "managed"]).default("native"),
      profileId: id.optional(),
      url: z.string().default("about:blank"),
    }),
    output: job,
  },
  frame: {
    input: z.object({ id }),
    output: z.object({
      data: z.string(),
      url: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  },
  input: { input: z.object({ id, input: viewerInput }), output: job },
  inspect: { input: z.object({ id }), output: hostSession },
  submit: {
    input: z.object({
      id,
      operation,
      timeoutMs: z.number().int().min(1000).max(600000).default(120000),
    }),
    output: job,
  },
  job: { input: z.object({ id }), output: job },
  cancel: { input: z.object({ id }), output: job },
  release: {
    input: z.object({ id }),
    output: z.object({ released: z.boolean() }),
  },
  artifacts: { input: z.object({ id }), output: z.array(artifact) },
  image: {
    input: z.object({ sessionId: id, artifactId: id }),
    output: z.object({ base64: z.string(), mime: z.string() }),
  },
});
export const startInput = z.object({
  newTab: z.boolean().default(false),
  threadId: id,
  mode: z.enum(["managed", "native"]).default("managed"),
  hostId: id.optional(),
  instanceId: id.optional(),
  generation: id.optional(),
  tabId: id.optional(),
  url: z.string().default("about:blank"),
  allowPersonal: z.boolean().default(false),
});
const machineInput = z.object({
  hostId: id.optional(),
  threadId: id.optional(),
});
export const rpcContract = defineRpcContract({
  machines: {
    input: z.null(),
    output: z.array(
      z.object({ hostId: id, label: z.string(), connected: z.boolean() }),
    ),
  },
  preferences: {
    input: z.object({ preferredHost: z.string().max(200).optional() }),
    output: z.object({ preferredHost: z.string() }),
  },
  discover: {
    input: z.null(),
    output: z.array(
      z.object({
        hostId: id,
        label: z.string(),
        instances: z.array(
          z.object({ instanceId: id, generation: id, label: z.string() }),
        ),
        error: z.string().optional(),
      }),
    ),
  },
  tabs: {
    input: startInput,
    output: z.array(
      z.object({
        tabId: id,
        title: z.string(),
        url: z.string(),
        profile: z.string(),
        controller: z.string().nullable(),
      }),
    ),
  },
  list: {
    input: z.object({ threadId: id.optional() }),
    output: z.array(session),
  },
  start: { input: startInput, output: z.object({ session, job }) },
  reconnect: { input: z.object({ id }), output: z.object({ session, job }) },
  probe: { input: machineInput, output: health.extend({ hostId: id }) },
  setup: {
    input: machineInput.extend({ dependencies: z.boolean().default(true) }),
    output: job.extend({ hostId: id }),
  },
  frame: hostContract.frame,
  input: hostContract.input,
  run: {
    input: z.object({
      id,
      operation,
      timeoutMs: z.number().int().min(1000).max(600000).default(120000),
    }),
    output: job,
  },
  job: { input: z.object({ hostId: id, id }), output: job },
  cancel: { input: z.object({ hostId: id, id }), output: job },
  release: {
    input: z.object({ id }),
    output: z.object({ released: z.boolean() }),
  },
  reveal: {
    input: z.object({ id }),
    output: z.object({ ok: z.boolean(), url: z.string().optional() }),
  },
  close: { input: z.object({ id }), output: z.object({ ok: z.boolean() }) },
  artifacts: { input: z.object({ id }), output: z.array(artifact) },
});
