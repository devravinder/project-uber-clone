import { Inject, Injectable } from "@nestjs/common";
import { CHANNELS, type GatewayMessage, type Trip } from "@apps/contracts";
import { Redis } from "@apps/kit";
import { randomUUID } from "node:crypto";

export const keys = {
  job: (tripId: string) => `mt:job:${tripId}`,
  due: "mt:due",
  offer: (driverId: string) => `mt:offer:${driverId}`,
  lock: (tripId: string) => `mt:lock:${tripId}`,
};

export type Job = {
  tripId: string;
  riderId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  fareMinor: number;
  currency: string;
  createdAt: number;
  attempt: number;
  radiusKm: number;
  declined: string[];
  offerDriver: string | null;
  offerUntil: number;
  offerDistanceKm: number;
};

// Created once per trip, even when the event is delivered twice.
const CREATE_JOB = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], unpack(ARGV, 4))
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[3])
return 1`;

// Only the holder may release; a lock retaken after expiry stays.
const UNLOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

const LOCK_TTL_MS = 5000;

@Injectable()
export class JobStore {
  constructor(@Inject(Redis) private readonly redis: Redis) {}

  async create(trip: Trip, dueAt: number, radiusKm: number, keepMs: number): Promise<boolean> {
    const fields = {
      tripId: trip.id,
      riderId: trip.riderId,
      pickupLat: trip.pickup.lat,
      pickupLng: trip.pickup.lng,
      dropoffLat: trip.dropoff.lat,
      dropoffLng: trip.dropoff.lng,
      fareMinor: trip.fareMinor,
      currency: trip.currency,
      createdAt: Date.parse(trip.requestedAt),
      attempt: 0,
      radiusKm,
      declined: "",
      offerDriver: "",
      offerUntil: 0,
      offerDistanceKm: 0,
    };
    const flat = Object.entries(fields).flatMap(([k, v]) => [k, String(v)]);
    const created = await this.redis.eval<number>(
      CREATE_JOB,
      [keys.job(trip.id), keys.due],
      [dueAt, keepMs, trip.id, ...flat],
    );
    return created === 1;
  }

  async get(tripId: string): Promise<Job | null> {
    const h = toRecord(await this.redis.cmd<unknown>(["HGETALL", keys.job(tripId)]));
    if (!h.tripId) return null;
    return {
      tripId: h.tripId!,
      riderId: h.riderId!,
      pickupLat: Number(h.pickupLat),
      pickupLng: Number(h.pickupLng),
      dropoffLat: Number(h.dropoffLat),
      dropoffLng: Number(h.dropoffLng),
      fareMinor: Number(h.fareMinor),
      currency: h.currency!,
      createdAt: Number(h.createdAt),
      attempt: Number(h.attempt),
      radiusKm: Number(h.radiusKm),
      declined: h.declined ? h.declined.split(",") : [],
      offerDriver: h.offerDriver || null,
      offerUntil: Number(h.offerUntil),
      offerDistanceKm: Number(h.offerDistanceKm),
    };
  }

  async update(tripId: string, patch: Partial<Job>): Promise<void> {
    const flat = Object.entries(patch).flatMap(([k, v]) => [
      k,
      Array.isArray(v) ? v.join(",") : v === null ? "" : String(v),
    ]);
    if (flat.length) await this.redis.cmd(["HSET", keys.job(tripId), ...flat]);
  }

  async schedule(tripId: string, at: number): Promise<void> {
    await this.redis.cmd(["ZADD", keys.due, String(at), tripId]);
  }

  async remove(tripId: string, offerDriver: string | null): Promise<void> {
    const commands = [
      this.redis.cmd(["DEL", keys.job(tripId)]),
      this.redis.cmd(["ZREM", keys.due, tripId]),
    ];
    if (offerDriver) commands.push(this.clearOffer(offerDriver, tripId));
    await Promise.all(commands);
  }

  due(now: number, limit: number): Promise<string[]> {
    return this.redis.cmd<string[]>([
      "ZRANGEBYSCORE",
      keys.due,
      "-inf",
      String(now),
      "LIMIT",
      "0",
      String(limit),
    ]);
  }

  async pending(limit: number): Promise<{ tripId: string; dueAt: number }[]> {
    const reply = await this.redis.cmd<unknown[]>([
      "ZRANGE",
      keys.due,
      "0",
      String(limit - 1),
      "WITHSCORES",
    ]);
    return toPairs(reply).map(([tripId, score]) => ({ tripId, dueAt: Number(score) }));
  }

  async setOffer(driverId: string, tripId: string, ttlMs: number): Promise<void> {
    await this.redis.cmd(["SET", keys.offer(driverId), tripId, "PX", String(ttlMs)]);
  }

  async currentOfferTrip(driverId: string): Promise<string | null> {
    return this.redis.cmd<string | null>(["GET", keys.offer(driverId)]);
  }

  // Deletes the driver's offer pointer only if it still points at this trip.
  async clearOffer(driverId: string, tripId: string): Promise<void> {
    await this.redis.eval(UNLOCK, [keys.offer(driverId)], [tripId]);
  }

  async publish(driverId: string, message: GatewayMessage): Promise<void> {
    await this.redis.cmd(["PUBLISH", CHANNELS.driverInbox(driverId), JSON.stringify(message)]);
  }

  async tryLock(tripId: string): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.redis.cmd<string | null>([
      "SET",
      keys.lock(tripId),
      token,
      "NX",
      "PX",
      String(LOCK_TTL_MS),
    ]);
    return ok ? token : null;
  }

  async unlock(tripId: string, token: string): Promise<void> {
    await this.redis.eval(UNLOCK, [keys.lock(tripId)], [token]);
  }
}

// node-redis 6 speaks RESP3: HGETALL is a map; RESP2 would give a flat list.
function toRecord(reply: unknown): Record<string, string> {
  if (Array.isArray(reply)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = String(reply[i + 1]);
    return out;
  }
  return (reply ?? {}) as Record<string, string>;
}

// WITHSCORES is [member, score] pairs in RESP3 and a flat list in RESP2.
function toPairs(reply: unknown[]): [string, string][] {
  if (reply.every((item) => Array.isArray(item))) {
    return (reply as unknown[][]).map(([m, s]) => [String(m), String(s)]);
  }
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < reply.length; i += 2) out.push([String(reply[i]), String(reply[i + 1])]);
  return out;
}
