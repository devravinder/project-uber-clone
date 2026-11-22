import { Controller, Get, Inject, Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@apps/kit";
import { gatewayEnvSchema } from "./config.js";
import { Channels } from "./gateway/channels.js";
import { Sessions } from "./gateway/sessions.js";
import { TripEventsConsumer } from "./gateway/trip-events.consumer.js";
import { WsServer } from "./gateway/ws.server.js";

@Controller("admin")
class AdminController {
  constructor(
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(TripEventsConsumer) private readonly consumer: TripEventsConsumer,
  ) {}

  @Get("stats")
  stats() {
    return { ...this.sessions.counts(), ...this.sessions.stats, tripEvents: this.consumer.stats };
  }
}

@Module({
  imports: [KitModule.forService(loadConfig(gatewayEnvSchema))],
  controllers: [AdminController],
  providers: [Channels, Sessions, WsServer, TripEventsConsumer],
})
export class AppModule {}
