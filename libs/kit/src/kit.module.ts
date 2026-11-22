import { type DynamicModule, Module } from "@nestjs/common";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";
import { HealthController, PostgresProbe } from "./health.controller.js";
import { KafkaConsumers, KafkaPublisher } from "./kafka.js";
import { Redis } from "./redis.js";
import {
  SWITCH_CHOICES,
  SWITCH_DEFAULTS,
  type SwitchChoices,
  type SwitchDefaults,
  Switches,
  SwitchesController,
} from "./switches.js";

export type KitOptions = { switches?: SwitchDefaults; choices?: SwitchChoices };

// What every service has: config, optional Redis and Kafka, switches, GET /health.
@Module({})
export class KitModule {
  static forService(config: BaseConfig, options: KitOptions = {}): DynamicModule {
    return {
      module: KitModule,
      global: true,
      controllers: [HealthController, SwitchesController],
      providers: [
        { provide: SERVICE_CONFIG, useValue: config },
        { provide: SWITCH_DEFAULTS, useValue: options.switches ?? {} },
        { provide: SWITCH_CHOICES, useValue: options.choices ?? {} },
        PostgresProbe,
        Redis,
        KafkaPublisher,
        KafkaConsumers,
        Switches,
      ],
      exports: [SERVICE_CONFIG, Redis, KafkaPublisher, KafkaConsumers, Switches],
    };
  }
}
