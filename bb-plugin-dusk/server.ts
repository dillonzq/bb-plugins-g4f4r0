import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULTS } from "./lib/config";

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
