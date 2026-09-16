import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULTS } from "./lib/config";

type KeyboardOverrides = Awaited<ReturnType<BbPluginApi["sdk"]["system"]["config"]>>["keybindingOverrides"];
type KeyboardOverride = KeyboardOverrides[number];
type KeyboardShortcut = NonNullable<KeyboardOverride["shortcut"]>;

const DUSK_SHORTCUT_COMMANDS = [
  "sidebar.toggle",
  "panel.toggle",
  "terminal.open",
  "palette.open",
  "thread.search",
  "file.quickOpen",
  "diff.toggle",
  "thread.new",
  "thread.previous",
  "thread.next",
  "modelPicker.toggle",
  "workspace.openPreferred",
] as const;

const DUSK_SHORTCUT_PRESET: KeyboardOverride[] = [
  { command: "sidebar.toggle", shortcut: { key: "b", mod: true, meta: false, control: false, alt: false, shift: false } },
  { command: "panel.toggle", shortcut: { key: "b", mod: true, meta: false, control: false, alt: true, shift: false } },
  { command: "terminal.open", shortcut: { key: "j", mod: true, meta: false, control: false, alt: false, shift: false } },
  { command: "palette.open", shortcut: { key: "k", mod: true, meta: false, control: false, alt: false, shift: false } },
  // Free Mod+K for the command palette while keeping thread search available.
  { command: "thread.search", shortcut: { key: "k", mod: true, meta: false, control: false, alt: false, shift: true } },
  { command: "file.quickOpen", shortcut: { key: "p", mod: true, meta: false, control: false, alt: false, shift: false } },
  { command: "diff.toggle", shortcut: { key: "d", mod: true, meta: false, control: false, alt: false, shift: false } },
  { command: "thread.new", shortcut: { key: "n", mod: true, meta: false, control: false, alt: false, shift: false } },
  { command: "thread.previous", shortcut: { key: "[", mod: true, meta: false, control: false, alt: false, shift: true } },
  { command: "thread.next", shortcut: { key: "]", mod: true, meta: false, control: false, alt: false, shift: true } },
  { command: "modelPicker.toggle", shortcut: { key: "m", mod: true, meta: false, control: false, alt: false, shift: true } },
  { command: "workspace.openPreferred", shortcut: { key: "o", mod: true, meta: false, control: false, alt: false, shift: false } },
];

const keyboardShortcutSchema = z.object({
  alt: z.boolean(),
  control: z.boolean(),
  key: z.string(),
  meta: z.boolean(),
  mod: z.boolean(),
  shift: z.boolean(),
}).strict();
const keyboardPresetStateSchema = z.object({
  version: z.literal(1),
  previous: z.array(z.object({
    command: z.enum(DUSK_SHORTCUT_COMMANDS),
    shortcut: keyboardShortcutSchema.nullable(),
  }).strict()),
}).strict();
const SHORTCUT_STATE_KEY = "keyboard-preset";

function isDuskShortcutCommand(command: string): boolean {
  return (DUSK_SHORTCUT_COMMANDS as readonly string[]).includes(command);
}

function sameShortcut(left: KeyboardShortcut | null, right: KeyboardShortcut | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatShortcut(shortcut: KeyboardShortcut): string {
  const modifiers = [
    shortcut.mod ? "Mod" : null,
    shortcut.meta ? "Meta" : null,
    shortcut.control ? "Ctrl" : null,
    shortcut.alt ? "Alt" : null,
    shortcut.shift ? "Shift" : null,
  ].filter(Boolean);
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return [...modifiers, key].join("+");
}

async function readShortcutState(bb: BbPluginApi) {
  const stored = await bb.storage.kv.get<unknown>(SHORTCUT_STATE_KEY);
  if (stored === undefined) return null;
  const parsed = keyboardPresetStateSchema.safeParse(stored);
  if (!parsed.success) throw new Error("Dusk shortcut state is invalid; refusing to overwrite keyboard settings.");
  return parsed.data;
}

async function applyDuskShortcuts(bb: BbPluginApi): Promise<void> {
  const current = (await bb.sdk.system.config()).keybindingOverrides;
  const state = await readShortcutState(bb);
  const previous = state?.previous ?? current
    .filter((entry) => isDuskShortcutCommand(entry.command))
    .map((entry) => ({ command: entry.command, shortcut: entry.shortcut }));
  const next = [
    ...current.filter((entry) => !isDuskShortcutCommand(entry.command)),
    ...DUSK_SHORTCUT_PRESET,
  ] as KeyboardOverrides;

  if (!state) await bb.storage.kv.set(SHORTCUT_STATE_KEY, { version: 1, previous });
  try {
    await bb.sdk.system.updateKeyboardSettings(next);
  } catch (error) {
    if (!state) await bb.storage.kv.delete(SHORTCUT_STATE_KEY);
    throw error;
  }
}

async function resetDuskShortcuts(bb: BbPluginApi): Promise<boolean> {
  const state = await readShortcutState(bb);
  if (!state) return false;
  const current = (await bb.sdk.system.config()).keybindingOverrides;
  const next = [
    ...current.filter((entry) => !isDuskShortcutCommand(entry.command)),
    ...state.previous,
  ] as KeyboardOverrides;
  await bb.sdk.system.updateKeyboardSettings(next);
  await bb.storage.kv.delete(SHORTCUT_STATE_KEY);
  return true;
}

function shortcutListJson(active: boolean) {
  return {
    name: "dusk",
    preset: "t3-inspired",
    active,
    shortcuts: DUSK_SHORTCUT_PRESET.map(({ command, shortcut }) => ({
      command,
      shortcut: formatShortcut(shortcut!),
    })),
  };
}

export const configSchema = z.object({
  image: z.string().max(220_000).nullable().refine((value) => {
    if (value === null) return true;
    if (!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const bytes = Buffer.from(value.split(",")[1], "base64");
    return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  }, "Choose a valid processed wallpaper."),
}).strict();
const threadIdSchema = z.string().regex(/^thr_[a-zA-Z0-9]+$/);
export const snoozeSchema = z.object({ threadId: threadIdSchema, until: z.number().int().positive(), at: z.number().int().positive() }).strict();
export type Snooze = z.infer<typeof snoozeSchema>;
const SNOOZE_KEY = "snoozes";

export const rpcContract = defineRpcContract({
  get: { input: z.null(), output: configSchema },
  save: { input: configSchema, output: configSchema },
  snoozes: { input: z.null(), output: z.array(snoozeSchema) },
  snooze: { input: z.object({ threadId: threadIdSchema, until: z.number().int().positive() }).strict(), output: z.array(snoozeSchema) },
  unsnooze: { input: z.object({ threadId: threadIdSchema }).strict(), output: z.array(snoozeSchema) },
  threadDetails: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ model: z.string().nullable(), reasoning: z.string().nullable(), provider: z.string().nullable(), modelProviderId: z.string().nullable(), fullTitle: z.string().nullable() }),
  },
  pinOrder: { input: z.null(), output: z.array(z.object({ threadId: z.string(), key: z.string().nullable() })) },
  history: { input: z.object({ threadId: threadIdSchema }).strict(), output: z.array(z.object({ question: z.string(), answer: z.string() })) },
});
export default function plugin(bb: BbPluginApi) {
  const shortcutUsage = [
    "Usage:",
    "  bb dusk shortcuts apply [--json]",
    "  bb dusk shortcuts list [--json]",
    "  bb dusk shortcuts reset [--json]",
  ].join("\n");

  bb.cli.register({
    name: "dusk",
    summary: "Apply Dusk's T3-inspired keyboard shortcuts",
    commands: [
      { name: "shortcuts", summary: "Apply, inspect, or reset Dusk shortcuts", usage: "bb dusk shortcuts <apply|list|reset> [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const args = argv.filter((argument) => argument !== "--json");
      if (args.length !== 2 || args[0] !== "shortcuts" || !["apply", "list", "reset"].includes(args[1] ?? "")) {
        return { exitCode: args.length === 0 ? 0 : 1, ...(args.length === 0 ? { stdout: shortcutUsage } : { stderr: shortcutUsage }) };
      }

      const action = args[1];
      try {
        if (action === "apply") {
          await applyDuskShortcuts(bb);
          return {
            exitCode: 0,
            stdout: json ? JSON.stringify({ action, active: true }) : "Applied the Dusk T3-inspired keyboard shortcuts. Use `bb dusk shortcuts reset` to restore the previous overrides.",
          };
        }
        if (action === "reset") {
          const restored = await resetDuskShortcuts(bb);
          return {
            exitCode: 0,
            stdout: json ? JSON.stringify({ action, restored }) : restored ? "Restored the keyboard overrides from before Dusk was applied." : "No Dusk keyboard preset is active.",
          };
        }

        const current = (await bb.sdk.system.config()).keybindingOverrides;
        const active = DUSK_SHORTCUT_PRESET.every((expected) => current.some((actual) => actual.command === expected.command && sameShortcut(actual.shortcut, expected.shortcut)));
        const result = shortcutListJson(active);
        return { exitCode: 0, stdout: json ? JSON.stringify(result) : [`Dusk shortcuts: ${active ? "active" : "inactive"}`, ...result.shortcuts.map(({ shortcut, command }) => `  ${shortcut.padEnd(12)} ${command}`)].join("\n") };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : "Could not update keyboard settings." };
      }
    },
  });

  // Snoozes live in Dusk's own storage, so removing Dusk removes them too.
  // Writes are serialized because each one rewrites the whole map.
  let snoozeWrites: Promise<unknown> = Promise.resolve();
  const readSnoozes = async (): Promise<Snooze[]> => {
    const parsed = z.array(snoozeSchema).safeParse(await bb.storage.kv.get(SNOOZE_KEY));
    const now = Date.now();
    return parsed.success ? parsed.data.filter((row) => row.until > now) : [];
  };
  const updateSnoozes = (change: (rows: Snooze[]) => Snooze[]) => {
    const next = snoozeWrites.then(async () => {
      const rows = change(await readSnoozes());
      await bb.storage.kv.set(SNOOZE_KEY, rows);
      bb.realtime.publish("snoozes", {});
      return rows;
    });
    snoozeWrites = next.catch(() => undefined);
    return next;
  };
  const clearSnooze = (threadId: string) => updateSnoozes((rows) => rows.filter((row) => row.threadId !== threadId));
  bb.events.on("thread.archived", ({ thread }) => { void clearSnooze(thread.id); });
  bb.events.on("thread.deleted", ({ thread }) => { void clearSnooze(thread.id); });
  bb.onDispose(bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      if (event.id !== undefined && event.changes.includes("pin-state-changed")) bb.realtime.publish("pins", {});
    },
  }));

  // Model lists change rarely and cost a provider round trip; cache briefly.
  type ModelInfo = { name: string; route: string | null };
  const modelCache = new Map<string, { at: number; names: Promise<Map<string, ModelInfo>> }>();
  const modelNames = (providerId: string) => {
    const cached = modelCache.get(providerId);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.names;
    const names = bb.sdk.providers.models({ providerId })
      .then((result) => new Map(result.models.flatMap((m) => {
        const info = { name: m.displayName, route: m.routeProviderId ?? null };
        return [[m.id, info], [m.model, info]] as [string, ModelInfo][];
      })))
      .catch(() => { modelCache.delete(providerId); return new Map<string, ModelInfo>(); });
    modelCache.set(providerId, { at: Date.now(), names });
    return names;
  };

  const firstMessage = async (threadId: string): Promise<string | null> => {
    try {
      // The user's first turn request carries the prompt as sent.
      type Part = { type: string; text?: string };
      const rows = await bb.sdk.threads.events.list({ threadId, order: "asc", limit: "20", types: ["client/turn/requested"] });
      for (const row of rows) {
        const data = row.data as { initiator?: string; input?: Part[] };
        if (data.initiator !== "user") continue;
        const text = data.input?.flatMap((part) => part.type === "text" && part.text ? [part.text] : []).join("\n").trim();
        if (text) return text.replace(/\s+/g, " ");
      }
    } catch {}
    return null;
  };

  bb.rpc.register(rpcContract, {
    threadDetails: async ({ threadId }) => {
      const [thread, options] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        bb.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
      ]);
      const [names, providers, fullTitle] = await Promise.all([
        modelNames(thread.providerId),
        bb.sdk.providers.list().catch(() => []),
        // Untitled threads only carry BB's shortened first message; read it in full.
        thread.title ? Promise.resolve(null) : firstMessage(threadId),
      ]);
      const model = options?.model ?? null;
      const info = model === null ? undefined : names.get(model);
      return {
        model: model === null ? null : info?.name ?? model,
        reasoning: options && options.reasoningLevel !== "none" ? options.reasoningLevel : null,
        provider: providers.find((p) => p.id === thread.providerId)?.displayName ?? null,
        modelProviderId: info?.route ?? null,
        fullTitle,
      };
    },
    snoozes: () => readSnoozes(),
    snooze: ({ threadId, until }) => {
      if (until <= Date.now()) throw new Error("Choose a time in the future.");
      return updateSnoozes((rows) => [...rows.filter((row) => row.threadId !== threadId), { threadId, until, at: Date.now() }]);
    },
    unsnooze: ({ threadId }) => clearSnooze(threadId),
    pinOrder: async () => {
      const pins: { threadId: string; key: string | null }[] = [];
      for (let offset = 0; ; offset += 200) {
        const rows = await bb.sdk.threads.list({ archived: false, limit: 200, offset });
        for (const thread of rows) if (thread.pinnedAt !== null) pins.push({ threadId: thread.id, key: thread.pinSortKey });
        if (rows.length < 200 || offset >= 5000) break;
      }
      return pins;
    },
    history: async ({ threadId }) => {
      const outline = await bb.sdk.threads.conversationOutline({ threadId });
      const pairs: { question: string; answer: string }[] = [];
      for (const item of outline.items) {
        if (item.role === 'user') pairs.push({ question: item.preview || '', answer: '' });
        else if (pairs.length && item.preview) pairs[pairs.length - 1].answer = item.preview;
      }
      return pairs;
    },
    get: async () => {
      const stored = await bb.storage.kv.get<{ image?: unknown }>("homepage");
      const parsed = configSchema.safeParse({ image: stored?.image ?? null });
      return parsed.success ? parsed.data : DEFAULTS;
    },
    save: async (config) => {
      // Bounded image + settings fit under BB's 256 KiB KV limit.
      await bb.storage.kv.set("homepage", config);
      bb.realtime.publish("changed", {});
      return config;
    },
  });
}
