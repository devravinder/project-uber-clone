import { HttpException, Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { type BaseConfig, SERVICE_CONFIG } from "./config.js";
import { fail } from "./util.js";

// A refused connection retries forever inside node-redis; requests must not wait for it.
const CONNECT_TIMEOUT_MS = 1000;

export type MessageListener = (message: string, channel: string) => void;

// Connects on first use, so a service without REDIS_URL never opens a connection.
@Injectable()
export class Redis implements OnModuleDestroy {
  private readonly logger = new Logger(Redis.name);
  private client?: RedisClientType;
  private connecting?: Promise<unknown>;
  private subscriberClient?: RedisClientType;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: BaseConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.REDIS_URL);
  }

  async connected(): Promise<RedisClientType> {
    if (!this.config.REDIS_URL) throw new Error("REDIS_URL is not set");
    if (!this.client) {
      // Fail fast while disconnected instead of queueing commands until a timeout.
      this.client = createClient({ url: this.config.REDIS_URL, disableOfflineQueue: true });
      // Without a listener, a lost connection is an unhandled error that kills the process.
      this.client.on("error", () => undefined);
    }
    const client = this.client;
    this.connecting ??= client.connect().catch((error: unknown) => {
      this.connecting = undefined;
      throw error;
    });
    if (!client.isReady) await withTimeout(this.connecting, CONNECT_TIMEOUT_MS, "redis connect");
    return client;
  }

  // Raw commands keep the code close to redis-cli and independent of client helper names.
  async cmd<T = unknown>(args: string[]): Promise<T> {
    try {
      const client = await this.connected();
      return (await client.sendCommand(args)) as T;
    } catch (error) {
      if (error instanceof HttpException || (error as Error).name === "ErrorReply") throw error;
      this.logger.warn(`redis unavailable: ${String(error)}`);
      return fail(503, "REDIS_UNAVAILABLE", "redis is not reachable");
    }
  }

  eval<T = unknown>(script: string, keyNames: string[], args: (string | number)[]): Promise<T> {
    return this.cmd<T>(["EVAL", script, String(keyNames.length), ...keyNames, ...args.map(String)]);
  }

  // A subscribed connection can run no other command, so it gets its own client.
  async subscriber(): Promise<RedisClientType> {
    if (!this.subscriberClient) {
      const base = await this.connected();
      this.subscriberClient = base.duplicate();
      this.subscriberClient.on("error", () => undefined);
      await withTimeout(this.subscriberClient.connect(), CONNECT_TIMEOUT_MS, "redis subscriber");
    }
    return this.subscriberClient;
  }

  async ping(): Promise<string> {
    return `redis ${await (await this.connected()).ping()}`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriberClient?.isOpen) await this.subscriberClient.close();
    if (this.client?.isOpen) await this.client.close();
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timeout`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
