import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { TOPICS, tripEventSchema } from "@apps/contracts";
import { type BaseConfig, type ConsumedMessage, KafkaConsumers, SERVICE_CONFIG } from "@apps/kit";
import { Sessions } from "./sessions.js";

// Older events describe trips nobody is watching live any more.
const MAX_AGE_MS = 60_000;

// Each instance has its own group, so every instance sees every trip event.
@Injectable()
export class TripEventsConsumer implements OnApplicationBootstrap {
  readonly stats = { seen: 0, skippedOld: 0 };

  constructor(
    @Inject(KafkaConsumers) private readonly consumers: KafkaConsumers,
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(SERVICE_CONFIG) private readonly config: BaseConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.consumers.start({
      groupId: `location-gateway-${this.config.PORT}`,
      topics: [TOPICS.tripEvents],
      // "latest" lost the first events on idle partitions (ADR-026); the age filter skips history.
      startFrom: "earliest",
      handler: (message) => this.handle(message),
    });
  }

  // Bad events are skipped, not dead-lettered: the gateway only relays, other consumers own them.
  private async handle(message: ConsumedMessage): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(message.value);
    } catch {
      return;
    }
    const parsed = tripEventSchema.safeParse(raw);
    if (!parsed.success) return;
    this.stats.seen++;
    if (Date.now() - Date.parse(parsed.data.occurredAt) > MAX_AGE_MS) {
      this.stats.skippedOld++;
      return;
    }
    await this.sessions.onTrip(parsed.data.trip);
  }
}
