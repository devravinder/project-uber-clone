import { Module } from "@nestjs/common";
import { baseEnvSchema, KitModule, loadConfig } from "@apps/kit";
import { AdminController } from "./admin/admin.controller.js";
import { DriverStore } from "./drivers/driver.store.js";
import { DriversController } from "./drivers/drivers.controller.js";
import { DriversService } from "./drivers/drivers.service.js";
import { InternalController } from "./drivers/internal.controller.js";
import { LocationRate } from "./drivers/location-rate.js";
import { SweeperService } from "./drivers/sweeper.service.js";
import { TripEventsConsumer } from "./drivers/trip-events.consumer.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  imports: [
    KitModule.forService(loadConfig(baseEnvSchema), { switches: { heartbeatTtlSeconds: 30 } }),
  ],
  controllers: [DriversController, InternalController, AdminController],
  providers: [
    PrismaService,
    DriverStore,
    DriversService,
    LocationRate,
    SweeperService,
    TripEventsConsumer,
  ],
})
export class AppModule {}
