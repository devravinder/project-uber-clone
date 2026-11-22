import { z } from "zod";

export const baseEnvSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  SERVICE_NAME: z.string().min(1),
  // Services without a relational store (feed) leave these unset; /health checks what is set.
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  // Comma separated host:port list.
  KAFKA_BROKERS: z.string().min(1).optional(),
});

export type BaseConfig = z.infer<typeof baseEnvSchema>;

export const SERVICE_CONFIG = Symbol("SERVICE_CONFIG");

export function loadConfig<T extends z.ZodType<BaseConfig>>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const brokersOf = (config: BaseConfig): string[] =>
  (config.KAFKA_BROKERS ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
