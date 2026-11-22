import "reflect-metadata";
import { Logger, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";

// Database migrations run before start (the dev script runs prisma migrate deploy).
export async function bootstrap(appModule: Type): Promise<void> {
  const app = await NestFactory.create(appModule);
  app.enableShutdownHooks();
  const config = app.get<BaseConfig>(SERVICE_CONFIG);
  await app.listen(config.PORT);
  new Logger(config.SERVICE_NAME).log(`listening on http://localhost:${config.PORT}`);
}
