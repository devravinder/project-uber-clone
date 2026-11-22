import { Inject, Injectable } from "@nestjs/common";
import type { LatLng, NearbyDriver, Trip } from "@apps/contracts";
import { callJson, SERVICE_CONFIG } from "@apps/kit";
import type { MatchingConfig } from "./config.js";

@Injectable()
export class DriverClient {
  constructor(@Inject(SERVICE_CONFIG) private readonly config: MatchingConfig) {}

  private post<T>(path: string, body: unknown): Promise<T> {
    return callJson<T>("driver-service", `${this.config.DRIVER_URL}${path}`, {
      method: "POST",
      body,
    });
  }

  async nearby(at: LatLng, radiusKm: number, limit: number): Promise<NearbyDriver[]> {
    const url = `${this.config.DRIVER_URL}/drivers/nearby?lat=${at.lat}&lng=${at.lng}&radiusKm=${radiusKm}&limit=${limit}`;
    return (await callJson<{ items: NearbyDriver[] }>("driver-service", url)).items;
  }

  async reserve(driverId: string, tripId: string, ttlMs: number): Promise<boolean> {
    const path = `/internal/drivers/${encodeURIComponent(driverId)}/reserve`;
    return (await this.post<{ reserved: boolean }>(path, { tripId, ttlMs })).reserved;
  }

  async assign(driverId: string, tripId: string): Promise<boolean> {
    const path = `/internal/drivers/${encodeURIComponent(driverId)}/assign`;
    return (await this.post<{ assigned: boolean }>(path, { tripId })).assigned;
  }

  async release(driverId: string, tripId: string): Promise<boolean> {
    const path = `/internal/drivers/${encodeURIComponent(driverId)}/release`;
    return (await this.post<{ released: boolean }>(path, { tripId })).released;
  }
}

@Injectable()
export class TripClient {
  constructor(@Inject(SERVICE_CONFIG) private readonly config: MatchingConfig) {}

  get(tripId: string): Promise<Trip> {
    return callJson<Trip>(
      "trip-service",
      `${this.config.TRIP_URL}/trips/${encodeURIComponent(tripId)}`,
    );
  }

  assign(tripId: string, driverId: string): Promise<Trip> {
    return callJson<Trip>(
      "trip-service",
      `${this.config.TRIP_URL}/internal/trips/${encodeURIComponent(tripId)}/assign`,
      { method: "POST", body: { driverId } },
    );
  }

  noDrivers(tripId: string): Promise<Trip> {
    return callJson<Trip>(
      "trip-service",
      `${this.config.TRIP_URL}/internal/trips/${encodeURIComponent(tripId)}/no-drivers`,
      { method: "POST" },
    );
  }
}
