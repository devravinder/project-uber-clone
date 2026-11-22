import { Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@apps/kit";
import { riderEnvSchema } from "./config.js";
import { PrismaService } from "./prisma.service.js";
import { AdminController, RidersController } from "./riders/riders.controller.js";
import { RidersService } from "./riders/riders.service.js";
import { RidesController } from "./rides/rides.controller.js";
import { RidesService } from "./rides/rides.service.js";

@Module({
  imports: [KitModule.forService(loadConfig(riderEnvSchema))],
  controllers: [RidersController, RidesController, AdminController],
  providers: [PrismaService, RidersService, RidesService],
})
export class AppModule {}
