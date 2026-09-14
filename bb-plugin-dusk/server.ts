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
export const rpcContract = defineRpcContract({
  get: { input: z.null(), output: configSchema },
  save: { input: configSchema, output: configSchema },
  history: { input: z.object({ threadId: z.string().regex(/^thr_[a-zA-Z0-9]+$/) }).strict(), output: z.array(z.object({ question: z.string(), answer: z.string() })) },
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

  bb.rpc.register(rpcContract, {
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
