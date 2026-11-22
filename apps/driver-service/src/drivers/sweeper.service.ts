import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { DriverStore } from "./driver.store.js";

const INTERVAL_MS = 2000;

export type SweepStats = {
  runs: number;
  wentOffline: number;
  offersReleased: number;
  lastRunMs: number;
};

// Applies expired heartbeats and stale offers to the GEO sets.
@Injectable()
export class SweeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SweeperService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  readonly stats: SweepStats = { runs: 0, wentOffline: 0, offersReleased: 0, lastRunMs: 0 };

  constructor(@Inject(DriverStore) private readonly store: DriverStore) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.sweep().finally(() => {
        this.running = undefined;
      });
    }, INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private async sweep(): Promise<void> {
    const started = Date.now();
    try {
      for await (const ids of this.store.onlineIds()) {
        const results = await Promise.all(ids.map((id) => this.store.sweepOne(id)));
        for (const result of results) {
          if (result === "offline") this.stats.wentOffline++;
          if (result === "released") this.stats.offersReleased++;
        }
      }
      this.stats.runs++;
      this.stats.lastRunMs = Date.now() - started;
    } catch (error) {
      this.logger.warn(`sweep failed: ${String(error)}`);
    }
  }
}
