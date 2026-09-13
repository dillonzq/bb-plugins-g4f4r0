import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createMessageTimeCache } from "./lib/message-time-cache";
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
  sidebarTimes: { input: z.object({ ids: z.array(z.string().regex(/^thr_[a-zA-Z0-9]+$/)).max(50) }).strict(), output: z.record(z.string(), z.number().nullable()) },
});
export default function plugin(bb: BbPluginApi) {

  async function messageTime(threadId: string): Promise<number | null> {
    let beforeSeq: string | undefined;
    for (let page = 0; page < 8; page++) {
      const events = await bb.sdk.threads.events.list({ threadId, order: 'desc', limit: '50', beforeSeq,
        types: ['client/turn/requested', 'item/agentMessage/delta', 'item/completed'] });
      const message = events.find(event => event.type === 'client/turn/requested' || event.type === 'item/agentMessage/delta' ||
        (event.type === 'item/completed' && event.data.item.type === 'agentMessage'));
      if (message || events.length < 50) {
        const value = message?.createdAt ?? null;
        return value;
      }
      beforeSeq = String(events[events.length - 1].seq);
    }
    return null;
  }
  const times = createMessageTimeCache(messageTime);
  bb.events.on("experimental_thread.events", ({ thread }) => { times.invalidate(thread.id); });
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
    sidebarTimes: async ({ ids }) => {
      const result: Record<string, number | null> = {};
      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i += 4) await Promise.all(unique.slice(i, i + 4).map(async id => { result[id] = await times.get(id); }));
      return result;
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
