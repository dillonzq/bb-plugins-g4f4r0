/** Bound traffic during sustained display-ACK delay; never oscillate quality. */
export class VideoPressure {
  private baseline = Infinity;
  private slowSince: number | undefined;
  private slowSamples = 0;
  private changedAt = -Infinity;
  private bitrate = 4000;

  sample(roundTripMs: number, now: number): number | undefined {
    if (
      !Number.isFinite(roundTripMs) ||
      roundTripMs < 0 ||
      !Number.isFinite(now)
    )
      return;
    this.baseline = Math.min(this.baseline, roundTripMs);
    // Absolute ceiling also catches a connection congested from its first frame.
    const threshold = Math.min(500, Math.max(300, this.baseline * 1.8));
    if (roundTripMs <= threshold) {
      this.slowSince = undefined;
      this.slowSamples = 0;
      return;
    }
    this.slowSince ??= now;
    this.slowSamples++;
    if (
      now - this.slowSince < 2000 ||
      this.slowSamples < 6 ||
      now - this.changedAt < 5000 ||
      this.bitrate <= 2000
    )
      return;
    this.bitrate = Math.max(2000, Math.round(this.bitrate * 0.75));
    this.changedAt = now;
    this.slowSince = undefined;
    this.slowSamples = 0;
    return this.bitrate;
  }
}
