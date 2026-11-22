import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { type BaseConfig, SERVICE_CONFIG } from "@apps/kit";
import { PrismaClient } from "./generated/prisma/client.js";

// One client per service; the generated path is per service, so this class is too.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(SERVICE_CONFIG) config: BaseConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
