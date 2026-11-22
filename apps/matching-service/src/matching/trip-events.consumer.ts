import { HttpException, Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { TOPICS, tripEventSchema } from "@apps/contracts";
import { type ConsumedMessage, KafkaConsumers, PermanentError } from "@apps/kit";
import { MatcherService } from "./matcher.service.js";

// A busy trip lock or Redis outage heals by itself; retry instead of dead-lettering.
const transient = (error: unknown) =>
  error instanceof HttpException && [409, 503].includes(error.getStatus());

@Injectable()
export class TripEventsConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(KafkaConsumers) private readonly consumers: KafkaConsumers,
    @Inject(MatcherService) private readonly matcher: MatcherService,
  ) {}

  onApplicationBootstrap(): void {
    this.consumers.start({
      groupId: "matching-service",
      topics: [TOPICS.tripEvents],
      handler: (message) => this.handle(message),
      isTransient: transient,
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
    const { type, trip } = parsed.data;
    if (type === "TripRequested") await this.matcher.startJob(trip);
    if (type === "TripCancelled") await this.matcher.closeByEvent(trip, "cancelled");
    if (type === "TripNoDrivers" || type === "TripMatched") {
      await this.matcher.closeByEvent(trip, "expired");
    }
  }
}
