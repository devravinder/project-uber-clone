import { Inject, Injectable } from "@nestjs/common";
import type { Quote } from "@apps/contracts";
import { Redis } from "@apps/kit";

const SEEN_TTL_SECONDS = 24 * 3600;
// Longest window a switch may ask for, plus a minute of slack.
const DEMAND_TTL_SECONDS = 61 * 60;

export const keys = {
  quote: (id: string) => `prc:quote:${id}`,
  demand: (cell: string, minute: number) => `prc:demand:${cell}:${minute}`,
  cells: "prc:cells",
  seen: (eventId: string) => `prc:seen:${eventId}`,
};

// Dedupe and count in one step, so a redelivered event is never counted twice.
const COUNT_DEMAND = `
if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then return 0 end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[4])
return 1`;

export const minuteOf = (ms: number) => Math.floor(ms / 60_000);

@Injectable()
export class PricingStore {
  constructor(@Inject(Redis) private readonly redis: Redis) {}

  async saveQuote(quote: Quote, ttlSeconds: number): Promise<void> {
    await this.redis.cmd([
      "SET",
      keys.quote(quote.id),
      JSON.stringify(quote),
      "EX",
      String(ttlSeconds),
    ]);
  }

  async quote(id: string): Promise<Quote | null> {
    const raw = await this.redis.cmd<string | null>(["GET", keys.quote(id)]);
    return raw ? (JSON.parse(raw) as Quote) : null;
  }

  async countDemand(eventId: string, cell: string, atMs: number): Promise<boolean> {
    const added = await this.redis.eval<number>(
      COUNT_DEMAND,
      [keys.seen(eventId), keys.demand(cell, minuteOf(atMs)), keys.cells],
      [SEEN_TTL_SECONDS, DEMAND_TTL_SECONDS, Date.now(), cell],
    );
    return added === 1;
  }

  // One counter per minute; the window sums the last N of them.
  async demand(cell: string, windowMinutes: number, nowMs = Date.now()): Promise<number> {
    const now = minuteOf(nowMs);
    const names = Array.from({ length: windowMinutes }, (_, i) => keys.demand(cell, now - i));
    const values = await this.redis.cmd<(string | null)[]>(["MGET", ...names]);
    return values.reduce((sum, v) => sum + Number(v ?? 0), 0);
  }

  activeCells(sinceMs: number, limit: number): Promise<string[]> {
    return this.redis.cmd<string[]>([
      "ZREVRANGEBYSCORE",
      keys.cells,
      "+inf",
      String(sinceMs),
      "LIMIT",
      "0",
      String(limit),
    ]);
  }
}
