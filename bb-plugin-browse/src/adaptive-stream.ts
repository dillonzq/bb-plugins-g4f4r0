export const streamProfiles = [
  { quality: 80, maxWidth: 1920, maxHeight: 1080 },
  { quality: 65, maxWidth: 1280, maxHeight: 800 },
  { quality: 50, maxWidth: 960, maxHeight: 600 },
] as const;

// Sample completed frame deliveries, not FPS: static pages need no new frames.
export class AdaptiveStream {
  tier = 0;
  ackMs = 0;
  clientMs = 0;
  private at: number;
  private count = 0;
  private total = 0;
  private clientTotal = 0;
  private healthy = 0;
  constructor(now = Date.now()) {
    this.at = now;
  }
  sample(ackMs: number, clientMs: number, now = Date.now()) {
    this.count++;
    this.total += Math.min(10000, Math.max(0, ackMs));
    this.clientTotal += Math.min(10000, Math.max(0, clientMs));
    if (now - this.at < 2000 || this.count < 8) return;
    this.ackMs = this.total / this.count;
    this.clientMs = this.clientTotal / this.count;
    if (this.ackMs > 180 || this.clientMs > 35) {
      this.tier = Math.min(2, this.tier + 1);
      this.healthy = 0;
    } else if (this.ackMs < 110 && this.clientMs < 22) {
      if (++this.healthy >= 5) {
        this.tier = Math.max(0, this.tier - 1);
        this.healthy = 0;
      }
    } else this.healthy = 0;
    this.at = now;
    this.count = 0;
    this.total = 0;
    this.clientTotal = 0;
  }
}

// Capture is shared within a session. Honor the weakest active viewer, expire
// disconnected viewers, and never alter the browser's logical viewport.
export class StreamDemands {
  private viewers = new Map<string, { tier: number; at: number }>();
  update(stream: { id: string; tier: number } | undefined, now = Date.now()) {
    for (const [id, value] of this.viewers)
      if (now - value.at > 12000) this.viewers.delete(id);
    if (stream) {
      if (this.viewers.size >= 32 && !this.viewers.has(stream.id))
        this.viewers.delete(this.viewers.keys().next().value!);
      this.viewers.set(stream.id, {
        tier: Math.min(2, Math.max(0, stream.tier)),
        at: now,
      });
    }
    return Math.max(0, ...[...this.viewers.values()].map((v) => v.tier));
  }
}
