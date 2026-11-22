import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Switches } from "@apps/kit";
import { TripsService } from "./trips.service.js";

const INTERVAL_MS = 10_000;

// The trip owner ends unmatched trips, so a dead matcher cannot strand riders.
@Injectable()
export class ReaperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReaperService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  reaped = 0;

  constructor(
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running ??= this.reap().finally(() => {
        this.running = undefined;
      });
    }, INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private async reap(): Promise<void> {
    const seconds = this.switches.get<number>("requestTimeoutSeconds");
    try {
      const ids = await this.trips.staleRequested(new Date(Date.now() - seconds * 1000), 50);
      for (const id of ids) {
        try {
          await this.trips.transition(id, "noDrivers", { kind: "system", id: "reaper" });
          this.reaped++;
          this.logger.warn(`trip ${id} unmatched after ${seconds} s: no_drivers`);
        } catch (error) {
          // Matched or cancelled meanwhile: the version check refused, which is the point.
          if (!(error instanceof HttpException)) throw error;
        }
      }
    } catch (error) {
      this.logger.warn(`reaper failed: ${String(error)}`);
    }
  }
}
