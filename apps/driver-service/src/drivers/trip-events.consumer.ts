import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { TOPICS, tripEventSchema } from "@apps/contracts";
import { type ConsumedMessage, KafkaConsumers, PermanentError } from "@apps/kit";
import { DriverStore } from "./driver.store.js";

const ENDS = new Set(["TripCompleted", "TripCancelled", "TripNoDrivers"]);

// Frees the driver when a trip ends; the trip id check makes duplicates harmless.
@Injectable()
export class TripEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(TripEventsConsumer.name);
  readonly stats = { handled: 0, released: 0, assigned: 0 };

  constructor(
    @Inject(KafkaConsumers) private readonly consumers: KafkaConsumers,
    @Inject(DriverStore) private readonly store: DriverStore,
  ) {}

  onApplicationBootstrap(): void {
    this.consumers.start({
      groupId: "driver-service",
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
    const { type, trip } = parsed.data;
    this.stats.handled++;
    if (!trip.driverId) return;
    if (type === "TripMatched" && (await this.store.assign(trip.driverId, trip.id))) {
      this.stats.assigned++;
    }
    if (ENDS.has(type) && (await this.store.release(trip.driverId, trip.id))) {
      this.stats.released++;
      this.logger.log(`driver ${trip.driverId} free again after ${type} ${trip.id}`);
    }
  }
}
