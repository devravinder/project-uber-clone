import { Inject, Injectable } from "@nestjs/common";
import {
  FARE,
  geohashBounds,
  geohashEncode,
  type LatLng,
  type Quote,
  SURGE_CELL_PRECISION,
  type SurgeCell,
} from "@apps/contracts";
import { fail, newId, Switches } from "@apps/kit";
import { fareMinor, surgeMultiplier, tripEstimate } from "./fare.js";
import { PricingStore } from "./pricing.store.js";
import { SupplyClient } from "./supply.client.js";

@Injectable()
export class PricingService {
  quotes = 0;

  constructor(
    @Inject(PricingStore) private readonly store: PricingStore,
    @Inject(SupplyClient) private readonly supply: SupplyClient,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  private n(name: string): number {
    return this.switches.get<number>(name);
  }

  async surgeAt(at: LatLng): Promise<SurgeCell> {
    const cell = geohashEncode(at, SURGE_CELL_PRECISION);
    const [demand, supply] = await Promise.all([
      this.store.demand(cell, Math.max(1, Math.min(60, this.n("surgeWindowMinutes")))),
      this.supply.availableNear(at, this.n("supplyRadiusKm")),
    ]);
    const forced = this.n("forceSurge");
    let surge = 1;
    if (forced > 0) surge = forced;
    else if (this.switches.get<boolean>("surgeEnabled")) {
      surge = surgeMultiplier(demand, supply, this.n("surgeMax"));
    }
    return { cell, ...geohashBounds(cell), demand, supply, surge };
  }

  async quote(riderId: string, pickup: LatLng, dropoff: LatLng): Promise<Quote> {
    const { distanceKm, durationMin } = tripEstimate(pickup, dropoff);
    const surge = await this.surgeAt(pickup);
    const now = Date.now();
    const ttl = Math.max(10, this.n("quoteTtlSeconds"));
    const quote: Quote = {
      id: `q${newId(now)}`,
      riderId,
      pickup,
      dropoff,
      distanceKm,
      durationMin,
      surge: surge.surge,
      fareMinor: fareMinor(distanceKm, durationMin, surge.surge),
      currency: FARE.currency,
      cell: surge.cell,
      demand: surge.demand,
      supply: surge.supply,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
    };
    await this.store.saveQuote(quote, ttl);
    this.quotes++;
    return quote;
  }

  async get(id: string): Promise<Quote> {
    const quote = await this.store.quote(id);
    if (!quote) fail(404, "QUOTE_NOT_FOUND", `quote ${id} does not exist or has expired`);
    return quote;
  }

  // Cells with recent requests, busiest first; supply is asked at each cell's centre.
  async activeCells(limit: number): Promise<SurgeCell[]> {
    const since = Date.now() - this.n("surgeWindowMinutes") * 60_000;
    const cells = await this.store.activeCells(since, limit);
    const result = await Promise.all(
      cells.map((cell) => {
        const b = geohashBounds(cell);
        return this.surgeAt({ lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 });
      }),
    );
    return result.filter((c) => c.demand > 0).sort((a, b) => b.demand - a.demand);
  }
}
