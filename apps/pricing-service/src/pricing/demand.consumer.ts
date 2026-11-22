import { HttpException, Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { geohashEncode, SURGE_CELL_PRECISION, TOPICS, tripEventSchema } from "@apps/contracts";
import { type ConsumedMessage, KafkaConsumers, PermanentError } from "@apps/kit";
import { PricingStore } from "./pricing.store.js";

// Demand is counted at the minute the trip was requested, not when the event arrived.
@Injectable()
export class DemandConsumer implements OnApplicationBootstrap {
  readonly stats = { counted: 0, duplicates: 0 };

  constructor(
    @Inject(KafkaConsumers) private readonly consumers: KafkaConsumers,
    @Inject(PricingStore) private readonly store: PricingStore,
  ) {}

  onApplicationBootstrap(): void {
    this.consumers.start({
      groupId: "pricing-service",
      topics: [TOPICS.tripEvents],
      handler: (message) => this.handle(message),
      isTransient: (error) => error instanceof HttpException && error.getStatus() === 503,
    });
  }

  private async handle(message: ConsumedMessage): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(message.value);
    } catch {
      throw new PermanentError("not JSON");
    }
    const parsed = tripEventSchema.safeParse(raw);
    if (!parsed.success) throw new PermanentError(`invalid trip event: ${parsed.error.message}`);
    const { eventId, type, trip } = parsed.data;
    if (type !== "TripRequested") return;
    const cell = geohashEncode(trip.pickup, SURGE_CELL_PRECISION);
    const counted = await this.store.countDemand(eventId, cell, Date.parse(trip.requestedAt));
    if (counted) this.stats.counted++;
    else this.stats.duplicates++;
  }
}
