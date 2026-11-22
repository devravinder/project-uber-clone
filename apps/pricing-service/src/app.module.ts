import { Controller, Get, Inject, Module } from "@nestjs/common";
import { KitModule, loadConfig } from "@apps/kit";
import { PRICING_SWITCHES, pricingEnvSchema } from "./config.js";
import { DemandConsumer } from "./pricing/demand.consumer.js";
import { PricingController } from "./pricing/pricing.controller.js";
import { PricingService } from "./pricing/pricing.service.js";
import { PricingStore } from "./pricing/pricing.store.js";
import { SupplyClient } from "./pricing/supply.client.js";

@Controller("admin")
class AdminController {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(SupplyClient) private readonly supply: SupplyClient,
    @Inject(DemandConsumer) private readonly demand: DemandConsumer,
  ) {}

  @Get("stats")
  stats() {
    return {
      quotes: this.pricing.quotes,
      supplyFallbacks: this.supply.fallbacks,
      demandEvents: this.demand.stats,
    };
  }
}

@Module({
  imports: [KitModule.forService(loadConfig(pricingEnvSchema), { switches: PRICING_SWITCHES })],
  controllers: [PricingController, AdminController],
  providers: [PricingStore, SupplyClient, PricingService, DemandConsumer],
})
export class AppModule {}
