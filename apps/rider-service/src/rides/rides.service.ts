import { Inject, Injectable, Logger } from "@nestjs/common";
import type { LatLng, Page, Quote, Trip } from "@apps/contracts";
import {
  type CallOptions,
  callJson,
  callJsonWithStatus,
  relayUpstream,
  SERVICE_CONFIG,
  UpstreamError,
} from "@apps/kit";
import type { RiderConfig } from "../config.js";
import { RidersService } from "../riders/riders.service.js";

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);
  readonly stats = { estimates: 0, requests: 0, retries: 0 };

  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: RiderConfig,
    @Inject(RidersService) private readonly riders: RidersService,
  ) {}

  private async trip<T>(path: string, options: CallOptions = {}): Promise<T> {
    try {
      return await callJson<T>("trip-service", `${this.config.TRIP_URL}${path}`, options);
    } catch (error) {
      return relayUpstream(error, "TRIPS_UNAVAILABLE");
    }
  }

  async estimate(riderId: string, pickup: LatLng, dropoff: LatLng): Promise<Quote> {
    await this.riders.requireExists(riderId);
    this.stats.estimates++;
    try {
      return await callJson<Quote>("pricing-service", `${this.config.PRICING_URL}/quotes`, {
        method: "POST",
        user: riderId,
        body: { pickup, dropoff },
      });
    } catch (error) {
      return relayUpstream(error, "PRICING_UNAVAILABLE");
    }
  }

  // Retrying once is safe only because the quote id makes the request idempotent.
  async request(riderId: string, quoteId: string): Promise<{ status: number; body: Trip }> {
    await this.riders.requireExists(riderId);
    this.stats.requests++;
    const url = `${this.config.TRIP_URL}/trips`;
    const options: CallOptions = {
      method: "POST",
      user: riderId,
      body: { quoteId },
      timeoutMs: 3000,
    };
    try {
      return await callJsonWithStatus<Trip>("trip-service", url, options);
    } catch (error) {
      if (!(error instanceof UpstreamError) || error.status !== null) {
        return relayUpstream(error, "TRIPS_UNAVAILABLE");
      }
      this.stats.retries++;
      this.logger.warn(`request ride for ${quoteId} got no answer, retrying once`);
      try {
        return await callJsonWithStatus<Trip>("trip-service", url, options);
      } catch (retryError) {
        return relayUpstream(retryError, "TRIPS_UNAVAILABLE");
      }
    }
  }

  current(riderId: string): Promise<{ trip: Trip | null }> {
    return this.trip(`/riders/${encodeURIComponent(riderId)}/active-trip`);
  }

  history(riderId: string, limit: number, before: string | undefined): Promise<Page<Trip>> {
    const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
    return this.trip(`/riders/${encodeURIComponent(riderId)}/trips?${query}`);
  }

  cancel(riderId: string, tripId: string, reason: string | undefined): Promise<Trip> {
    return this.trip(`/trips/${encodeURIComponent(tripId)}/cancel`, {
      method: "POST",
      user: riderId,
      body: reason ? { reason } : {},
    });
  }
}
