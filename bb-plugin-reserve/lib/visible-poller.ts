/** Serialized polling with stale-response protection across hide/show and disposal. */
export function createVisiblePoller<T>(options: {
  load: () => Promise<T>;
  receive: (value: T) => void;
  error: (error: unknown) => void;
  clear: () => void;
  intervalMs: (value: T) => number;
}) {
  let active = false;
  let disposed = false;
  let generation = 0;
  let pending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll() {
    if (!active || disposed || pending) return;
    pending = true;
    const requestGeneration = generation;
    let delay = 5000;
    try {
      const value = await options.load();
      if (!active || disposed || requestGeneration !== generation) return;
      failures = 0;
      delay = Math.min(300_000, Math.max(2000, options.intervalMs(value) || 5000));
      options.receive(value);
    } catch (error) {
      if (!active || disposed || requestGeneration !== generation) return;
      failures = Math.min(failures + 1, 5);
      delay = Math.min(60_000, 5000 * 2 ** (failures - 1));
      options.error(error);
    } finally {
      pending = false;
      if (active && !disposed) {
        timer = setTimeout(() => { timer = undefined; void poll(); }, requestGeneration === generation ? delay : 0);
      }
    }
  }

  return {
    setActive(next: boolean) {
      if (disposed || next === active) return;
      active = next;
      generation++;
      clearTimeout(timer);
      timer = undefined;
      if (active) void poll();
      else { failures = 0; options.clear(); }
    },
    refresh() {
      if (disposed || !active) return false;
      generation++;
      clearTimeout(timer);
      timer = undefined;
      if (!pending) void poll();
      return true;
    },
    dispose() {
      disposed = true;
      active = false;
      generation++;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
