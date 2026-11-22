import { Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@apps/kit";
import { DriverClient, TripClient } from "./clients.js";
import { MATCHING_SWITCHES, matchingEnvSchema } from "./config.js";
import { JobStore } from "./matching/job.store.js";
import { MatcherService } from "./matching/matcher.service.js";
import {
  AdminController,
  OffersController,
  ProgressController,
} from "./matching/offers.controller.js";
import { TripEventsConsumer } from "./matching/trip-events.consumer.js";

@Module({
  imports: [KitModule.forService(loadConfig(matchingEnvSchema), { switches: MATCHING_SWITCHES })],
  controllers: [OffersController, ProgressController, AdminController],
  providers: [DriverClient, TripClient, JobStore, MatcherService, TripEventsConsumer],
})
export class AppModule {}
