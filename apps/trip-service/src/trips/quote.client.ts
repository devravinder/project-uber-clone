import { Inject, Injectable } from "@nestjs/common";
import type { Quote } from "@apps/contracts";
import { callJson, fail, SERVICE_CONFIG, UpstreamError } from "@apps/kit";
import type { TripConfig } from "../config.js";

@Injectable()
export class QuoteClient {
  constructor(@Inject(SERVICE_CONFIG) private readonly config: TripConfig) {}

  async get(quoteId: string): Promise<Quote> {
    try {
      return await callJson<Quote>(
        "pricing-service",
        `${this.config.PRICING_URL}/quotes/${encodeURIComponent(quoteId)}`,
        { timeoutMs: 1500 },
      );
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) {
        fail(410, "QUOTE_EXPIRED", `quote ${quoteId} has expired; ask for a new estimate`);
      }
      return fail(503, "PRICING_UNAVAILABLE", `cannot read the quote: ${(error as Error).message}`);
    }
  }
}
