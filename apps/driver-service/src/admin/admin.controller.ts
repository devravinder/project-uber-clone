import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { parse } from "@apps/kit";
import { z } from "zod";
import { DriverStore } from "../drivers/driver.store.js";
import { DriversService } from "../drivers/drivers.service.js";
import { LocationRate } from "../drivers/location-rate.js";
import { SweeperService } from "../drivers/sweeper.service.js";
import { TripEventsConsumer } from "../drivers/trip-events.consumer.js";

const seedSchema = z.object({
  count: z.number().int().min(1).max(5000).default(50),
  prefix: z
    .string()
    .regex(/^[a-z_]{1,10}$/)
    .default("d"),
});

@Controller("admin")
export class AdminController {
  constructor(
    @Inject(DriversService) private readonly drivers: DriversService,
    @Inject(DriverStore) private readonly store: DriverStore,
    @Inject(LocationRate) private readonly rate: LocationRate,
    @Inject(SweeperService) private readonly sweeper: SweeperService,
    @Inject(TripEventsConsumer) private readonly consumer: TripEventsConsumer,
  ) {}

  // Idempotent: existing ids are skipped, so running the seed twice adds nothing.
  @Post("seed")
  @HttpCode(200)
  seed(@Body() body: unknown) {
    const input = parse(seedSchema, body ?? {});
    return this.drivers.seed(input.count, input.prefix);
  }

  @Get("stats")
  async stats() {
    const counts = await this.store.counts();
    return {
      ...counts,
      busy: counts.online - counts.available,
      locationWrites: this.rate.snapshot(),
      sweeper: this.sweeper.stats,
      tripEvents: this.consumer.stats,
    };
  }
}
