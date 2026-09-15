/** One live fetch at a time. A cached snapshot is always served immediately; ttl only starts a refresh. */
export function createCachedLoader<T>(options: {
  load: () => Promise<T>;
  ttlMs: (value: T) => number;
  now?: () => number;
}) {
  let cached: { value: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  const now = options.now ?? Date.now;

  function live(): Promise<T> {
    if (inflight !== null) return inflight;
    inflight = options.load().then((value) => {
      cached = { value, at: now() };
      return value;
    }).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function fresh(): boolean {
    return cached !== null && now() - cached.at < options.ttlMs(cached.value);
  }

  return {
    hydrate(value: T, at: number) {
      if (cached !== null) return;
      cached = { value, at };
    },
    get(force = false): Promise<T> {
      if (force) return live();
      if (cached !== null) {
        if (!fresh()) void live();
        return Promise.resolve(cached.value);
      }
      return live();
    },
    invalidate() {
      cached = null;
    },
  };
}
