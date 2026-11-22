import { Inject, Injectable } from "@nestjs/common";
import {
  CHANNELS,
  type DriverState,
  type DriverStatus,
  type LatLng,
  type NearbyDriver,
  type OnlineDriver,
} from "@apps/contracts";
import { Redis } from "@apps/kit";
import {
  ASSIGN,
  GO_OFFLINE,
  GO_ONLINE,
  LIST_ONLINE,
  RELEASE,
  RESERVE,
  SWEEP_ONE,
  UPDATE_LOCATION,
} from "./driver.scripts.js";

export const KEYS = {
  geoAll: "drv:geo",
  geoAvailable: "drv:geo:available",
  statePrefix: "drv:state:",
  state: (id: string) => `drv:state:${id}`,
  alive: (id: string) => `drv:alive:${id}`,
};

// Every Redis access for driver state; scripts keep each change atomic.
@Injectable()
export class DriverStore {
  constructor(@Inject(Redis) private readonly redis: Redis) {}

  private fourKeys(id: string): string[] {
    return [KEYS.state(id), KEYS.alive(id), KEYS.geoAll, KEYS.geoAvailable];
  }

  goOnline(id: string, at: LatLng, ttlSeconds: number): Promise<DriverStatus> {
    return this.redis.eval<DriverStatus>(GO_ONLINE, this.fourKeys(id), [
      id,
      at.lng,
      at.lat,
      Date.now(),
      ttlSeconds,
    ]);
  }

  updateLocation(id: string, at: LatLng, ttlSeconds: number): Promise<DriverStatus> {
    return this.redis.eval<DriverStatus>(UPDATE_LOCATION, this.fourKeys(id), [
      id,
      at.lng,
      at.lat,
      Date.now(),
      ttlSeconds,
      CHANNELS.driverLocation(id),
    ]);
  }

  goOffline(id: string): Promise<DriverStatus> {
    return this.redis.eval<DriverStatus>(GO_OFFLINE, this.fourKeys(id), [id]);
  }

  async reserve(id: string, tripId: string, ttlMs: number): Promise<boolean> {
    const keys = [KEYS.state(id), KEYS.alive(id), KEYS.geoAvailable];
    return (await this.redis.eval<number>(RESERVE, keys, [id, tripId, Date.now() + ttlMs])) === 1;
  }

  async assign(id: string, tripId: string): Promise<boolean> {
    return (await this.redis.eval<number>(ASSIGN, [KEYS.state(id)], [tripId])) === 1;
  }

  async release(id: string, tripId: string): Promise<boolean> {
    return (await this.redis.eval<number>(RELEASE, this.fourKeys(id), [id, tripId])) === 1;
  }

  sweepOne(id: string): Promise<string> {
    return this.redis.eval<string>(SWEEP_ONE, this.fourKeys(id), [id, Date.now()]);
  }

  async state(id: string): Promise<DriverState> {
    const [fields, alive] = await Promise.all([
      this.redis.cmd<string[]>(["HMGET", KEYS.state(id), "status", "tripId", "lat", "lng", "at"]),
      this.redis.cmd<number>(["EXISTS", KEYS.alive(id)]),
    ]);
    const [status, tripId, lat, lng, at] = fields;
    return {
      id,
      status: (status as DriverStatus | null) ?? "offline",
      tripId: tripId || null,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      updatedAt: at ? Number(at) : null,
      alive: alive === 1,
    };
  }

  // Only available drivers are in this set, so the search never returns busy ones.
  async nearby(at: LatLng, radiusKm: number, limit: number): Promise<NearbyDriver[]> {
    const rows = await this.redis.cmd<[string, string, [string, string]][]>([
      "GEOSEARCH",
      KEYS.geoAvailable,
      "FROMLONLAT",
      String(at.lng),
      String(at.lat),
      "BYRADIUS",
      String(radiusKm),
      "km",
      "ASC",
      "COUNT",
      String(limit),
      "WITHCOORD",
      "WITHDIST",
    ]);
    return rows.map(([driverId, dist, [lng, lat]]) => ({
      driverId,
      distanceKm: Number(dist),
      lat: Number(lat),
      lng: Number(lng),
    }));
  }

  async online(limit: number): Promise<OnlineDriver[]> {
    const flat = await this.redis.eval<string[]>(
      LIST_ONLINE,
      [KEYS.geoAll],
      [limit, KEYS.statePrefix],
    );
    const items: OnlineDriver[] = [];
    for (let i = 0; i + 3 < flat.length; i += 4) {
      items.push({
        driverId: flat[i]!,
        status: flat[i + 1] as DriverStatus,
        lng: Number(flat[i + 2]),
        lat: Number(flat[i + 3]),
      });
    }
    return items;
  }

  // ZSCAN pages through the set, so a sweep never blocks Redis.
  async *onlineIds(): AsyncGenerator<string[]> {
    let cursor = "0";
    do {
      const [next, flat] = await this.redis.cmd<[string, string[]]>([
        "ZSCAN",
        KEYS.geoAll,
        cursor,
        "COUNT",
        "500",
      ]);
      cursor = next;
      yield flat.filter((_, i) => i % 2 === 0);
    } while (cursor !== "0");
  }

  async counts(): Promise<{ online: number; available: number }> {
    const [online, available] = await Promise.all([
      this.redis.cmd<number>(["ZCARD", KEYS.geoAll]),
      this.redis.cmd<number>(["ZCARD", KEYS.geoAvailable]),
    ]);
    return { online, available };
  }
}
