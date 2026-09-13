// Reuse idle-thread timestamps and concurrent reads; never commit a stale read
// after an event invalidates it. The TTL also bounds recovery from missed events.
export function createMessageTimeCache(load: (id: string) => Promise<number | null>, now = Date.now) {
  const entries = new Map<string, { at: number; promise: Promise<number | null> }>();
  return {
    invalidate(id: string) { entries.delete(id); },
    get(id: string) {
      const hit = entries.get(id);
      if (hit && now() - hit.at < 300_000) return hit.promise;
      if (entries.size >= 1000) entries.delete(entries.keys().next().value!);
      const entry = { at: now(), promise: Promise.resolve(null as number | null) };
      entry.promise = Promise.resolve().then(() => load(id)).catch(error => {
        if (entries.get(id) === entry) entries.delete(id);
        throw error;
      });
      entries.set(id, entry);
      return entry.promise;
    },
  };
}
