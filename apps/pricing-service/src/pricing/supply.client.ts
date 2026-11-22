import { Inject, Injectable, Logger } from "@nestjs/common";
import type { LatLng, NearbyDriver } from "@apps/contracts";
import { callJson, SERVICE_CONFIG } from "@apps/kit";
import type { PricingConfig } from "../config.js";

// A quote must stay fast, so supply gets a short budget.
const TIMEOUT_MS = 800;

@Injectable()
export class SupplyClient {
  private readonly logger = new Logger(SupplyClient.name);
  fallbacks = 0;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: PricingConfig) {}

  // Null means unknown: pricing degrades to no surge instead of failing the quote.
  async availableNear(at: LatLng, radiusKm: number): Promise<number | null> {
    try {
      const url = `${this.config.DRIVER_URL}/drivers/nearby?lat=${at.lat}&lng=${at.lng}&radiusKm=${radiusKm}&limit=50`;
      const page = await callJson<{ items: NearbyDriver[] }>("driver-service", url, {
        timeoutMs: TIMEOUT_MS,
      });
      return page.items.length;
    } catch (error) {
      this.fallbacks++;
      this.logger.warn(`supply unknown, no surge: ${String(error)}`);
      return null;
    }
  }
}
