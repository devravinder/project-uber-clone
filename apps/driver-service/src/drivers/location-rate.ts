import { Injectable } from "@nestjs/common";

const WINDOW_SECONDS = 10;

// Location writes per second over the last 10 s, for the lab and load scripts.
@Injectable()
export class LocationRate {
  private readonly buckets = new Map<number, number>();
  private total = 0;

  record(): void {
    const second = Math.floor(Date.now() / 1000);
    this.buckets.set(second, (this.buckets.get(second) ?? 0) + 1);
    this.total++;
    if (this.buckets.size > WINDOW_SECONDS * 2) {
      for (const key of this.buckets.keys())
        if (key < second - WINDOW_SECONDS) this.buckets.delete(key);
    }
  }

  snapshot(): { total: number; perSecond: number } {
    const now = Math.floor(Date.now() / 1000);
    let sum = 0;
    // The current second is still filling, so the window ends at the previous one.
    for (let s = now - WINDOW_SECONDS; s < now; s++) sum += this.buckets.get(s) ?? 0;
    return { total: this.total, perSecond: Math.round(sum / WINDOW_SECONDS) };
  }
}
