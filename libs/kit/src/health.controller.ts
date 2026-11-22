import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import pg from "pg";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";
import { Redis } from "./redis.js";

const CHECK_TIMEOUT_MS = 3000;

type Check = { ok: boolean; detail: string };

// Connection failures arrive as AggregateError with an empty message; the code says more.
function describe(error: unknown): string {
  const e = error as Error & { code?: string; errors?: Error[] };
  return e.message || e.code || e.errors?.[0]?.message || e.name || "unknown error";
}

async function check(probe: () => Promise<string>): Promise<Check> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
  });
  try {
    return { ok: true, detail: await Promise.race([probe(), timeout]) };
  } catch (error) {
    return { ok: false, detail: describe(error) };
  } finally {
    clearTimeout(timer);
  }
}

// Tiny pool just for /health, so the kit does not depend on any ORM client.
@Injectable()
export class PostgresProbe implements OnModuleDestroy {
  private pool?: pg.Pool;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: BaseConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.DATABASE_URL);
  }

  async ping(): Promise<string> {
    this.pool ??= new pg.Pool({ connectionString: this.config.DATABASE_URL, max: 1 });
    this.pool.on("error", () => undefined);
    const { rows } = await this.pool.query<{ db: string; who: string }>(
      "SELECT current_database() AS db, current_user AS who",
    );
    return `postgres ${rows[0]!.db} as ${rows[0]!.who}`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}

// Explicit tokens: tsx (esbuild) emits no decorator metadata for Nest to read.
@Controller("health")
export class HealthController {
  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: BaseConfig,
    @Inject(PostgresProbe) private readonly postgres: PostgresProbe,
    @Inject(Redis) private readonly redis: Redis,
  ) {}

  @Get()
  async health() {
    const checks: Record<string, Check> = {};
    if (this.postgres.enabled) checks.postgres = await check(() => this.postgres.ping());
    if (this.redis.enabled) checks.redis = await check(() => this.redis.ping());
    const body = { service: this.config.SERVICE_NAME, port: this.config.PORT, ...checks };
    if (Object.values(checks).some((c) => !c.ok)) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
