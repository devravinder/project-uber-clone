import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { EVENT_ID_HEADER, EVENT_TYPE_HEADER } from "@apps/contracts";
import { KafkaPublisher } from "./kafka.js";
import { Switches } from "./switches.js";
import { backoffMs } from "./util.js";

export type OutboxRow = {
  id: string;
  topic: string;
  key: string;
  type: string;
  payload: string;
  attempts: number;
};

// Each service implements this over its own outbox table (Prisma, see the prisma-orm skill).
export interface OutboxStore {
  // Claims due rows with a lease so replicas get disjoint batches (FOR UPDATE SKIP LOCKED).
  claim(limit: number, leaseMs: number): Promise<OutboxRow[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, attempts: number, retryAt: Date): Promise<void>;
}

export const OUTBOX_STORE = Symbol("OUTBOX_STORE");

const BATCH = 50;
const LEASE_MS = 30_000;

// Publishes outbox rows to Kafka. A crash between publish and markSent re-sends: at least once.
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    @Inject(OUTBOX_STORE) private readonly store: OutboxStore,
    @Inject(KafkaPublisher) private readonly kafka: KafkaPublisher,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.tick().finally(() => {
        this.running = undefined;
      });
    }, 200);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }

  // Lab switch `outboxPaused`: rows stay in the table, as if the broker were down.
  private paused(): boolean {
    try {
      return this.switches.get<boolean>("outboxPaused");
    } catch {
      return false;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.paused()) return;
    let rows: OutboxRow[];
    try {
      rows = await this.store.claim(BATCH, LEASE_MS);
    } catch (error) {
      this.logger.warn(`outbox claim failed: ${String(error)}`);
      return;
    }
    for (const row of rows) {
      try {
        await this.kafka.publish({
          topic: row.topic,
          key: row.key,
          value: row.payload,
          headers: { [EVENT_ID_HEADER]: row.id, [EVENT_TYPE_HEADER]: row.type },
        });
        await this.store.markSent(row.id);
      } catch (error) {
        const attempts = row.attempts + 1;
        this.logger.warn(`publish ${row.id} failed (attempt ${attempts}): ${String(error)}`);
        await this.store
          .markFailed(row.id, attempts, new Date(Date.now() + backoffMs(attempts)))
          .catch(() => undefined);
      }
    }
  }
}
