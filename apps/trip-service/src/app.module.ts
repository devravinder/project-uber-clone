import { Controller, Get, Inject, Module } from "@nestjs/common";
import { KitModule, loadConfig, OUTBOX_STORE, OutboxRelay } from "@apps/kit";
import { OutboxController } from "./admin/outbox.controller.js";
import { TRIP_SWITCHES, tripEnvSchema } from "./config.js";
import { PrismaOutboxStore } from "./outbox/prisma-outbox.store.js";
import { PrismaService } from "./prisma.service.js";
import { QuoteClient } from "./trips/quote.client.js";
import { ReaperService } from "./trips/reaper.service.js";
import {
  InternalTripsController,
  TripQueriesController,
  TripsController,
} from "./trips/trips.controller.js";
import { TripsService } from "./trips/trips.service.js";

@Controller("admin")
class StatsController {
  constructor(
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(ReaperService) private readonly reaper: ReaperService,
  ) {}

  @Get("stats")
  stats() {
    return { ...this.trips.stats, reaped: this.reaper.reaped };
  }
}

@Module({
  imports: [KitModule.forService(loadConfig(tripEnvSchema), { switches: TRIP_SWITCHES })],
  controllers: [
    TripsController,
    TripQueriesController,
    InternalTripsController,
    OutboxController,
    StatsController,
  ],
  providers: [
    PrismaService,
    QuoteClient,
    TripsService,
    ReaperService,
    PrismaOutboxStore,
    { provide: OUTBOX_STORE, useExisting: PrismaOutboxStore },
    OutboxRelay,
  ],
})
export class AppModule {}
