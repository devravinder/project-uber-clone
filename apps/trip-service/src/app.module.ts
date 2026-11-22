import { Module } from "@nestjs/common";
import { baseEnvSchema, KitModule, loadConfig } from "@apps/kit";

@Module({
  imports: [KitModule.forService(loadConfig(baseEnvSchema))],
})
export class AppModule {}
