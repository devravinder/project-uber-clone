import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  Consumer,
  type MessagesStream,
  Producer,
  stringDeserializers,
  stringSerializers,
} from "@platformatic/kafka";
import { type BaseConfig, brokersOf, SERVICE_CONFIG } from "./config.js";
import { backoffMs, sleep } from "./util.js";

const PUBLISH_TIMEOUT_MS = 10_000;

export type OutgoingMessage = {
  topic: string;
  key: string;
  value: string;
  headers?: Record<string, string>;
};

// Idempotent producer: a retried send is stored once. Created on first use.
@Injectable()
export class KafkaPublisher implements OnModuleDestroy {
  private producer?: Producer<string, string, string, string>;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: BaseConfig) {}

  get enabled(): boolean {
    return brokersOf(this.config).length > 0;
  }

  private get client(): Producer<string, string, string, string> {
    this.producer ??= new Producer({
      clientId: this.config.SERVICE_NAME,
      bootstrapBrokers: brokersOf(this.config),
      serializers: stringSerializers,
      idempotent: true,
      acks: -1,
    });
    return this.producer;
  }

  // A hung broker waits instead of failing, so every send is bounded.
  async publish(message: OutgoingMessage): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("kafka publish timeout")), PUBLISH_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.client.send({ messages: [message] }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer?.close().catch(() => undefined);
  }
}

export type ConsumedMessage = {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string;
  headers: Record<string, string>;
};

// Throw this for input that will never succeed: it goes to the DLT without retries.
export class PermanentError extends Error {}

export type ConsumerOptions = {
  groupId: string;
  topics: string[];
  handler: (message: ConsumedMessage) => Promise<void>;
  // New group: start at the beginning (replay) or only at new events.
  startFrom?: "earliest" | "latest";
  maxAttempts?: number;
  // Outages (Redis or a service down) retry until they heal, instead of dead-lettering.
  isTransient?: (error: unknown) => boolean;
};

type StringStream = MessagesStream<string, string, string, string>;

// At-least-once: commit after the handler succeeds. Failures retry, then go to <topic>.dlt.
@Injectable()
export class KafkaConsumers implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumers.name);
  private readonly running: Promise<void>[] = [];
  private readonly streams = new Set<StringStream>();
  private readonly dlt: KafkaPublisher;
  private stopping = false;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: BaseConfig) {
    this.dlt = new KafkaPublisher(config);
  }

  // Not awaited: the HTTP API keeps serving while Kafka is down; the loop reconnects.
  start(options: ConsumerOptions): void {
    this.running.push(this.loop(options));
  }

  private async loop(options: ConsumerOptions): Promise<void> {
    for (let attempt = 0; !this.stopping; attempt++) {
      const consumer = new Consumer({
        groupId: options.groupId,
        clientId: `${this.config.SERVICE_NAME}-${options.groupId}`,
        bootstrapBrokers: brokersOf(this.config),
        deserializers: stringDeserializers,
      });
      try {
        const stream = await consumer.consume({
          topics: options.topics,
          mode: "committed",
          fallbackMode: options.startFrom ?? "earliest",
          autocommit: false,
          maxWaitTime: 1000,
        });
        this.streams.add(stream);
        this.logger.log(`consuming ${options.topics.join(",")} as group ${options.groupId}`);
        attempt = 0;
        // One at a time keeps each partition in order and gives back-pressure.
        for await (const raw of stream) {
          const message: ConsumedMessage = {
            topic: raw.topic,
            partition: raw.partition,
            offset: String(raw.offset),
            key: raw.key ?? null,
            value: raw.value,
            headers: Object.fromEntries(raw.headers ?? []),
          };
          await this.process(options, message);
          await raw.commit();
        }
      } catch (error) {
        if (this.stopping) break;
        const delay = backoffMs(attempt, 1000, 15_000);
        this.logger.warn(
          `consumer ${options.groupId} failed, retry in ${delay} ms: ${String(error)}`,
        );
        await sleep(delay);
      } finally {
        await consumer.close(true).catch(() => undefined);
      }
    }
  }

  private async process(options: ConsumerOptions, message: ConsumedMessage): Promise<void> {
    const maxAttempts = options.maxAttempts ?? 4;
    let lastError: unknown;
    for (let attempt = 0; !this.stopping; attempt++) {
      try {
        await options.handler(message);
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof PermanentError) break;
        const transient = options.isTransient?.(error) ?? false;
        if (!transient && attempt + 1 >= maxAttempts) break;
        // The partition waits here; later events must not overtake this one.
        if (transient && attempt % 10 === 0) {
          this.logger.warn(
            `${message.topic}@${message.partition}:${message.offset} waiting: ${String(error)}`,
          );
        }
        await sleep(backoffMs(attempt, 200, transient ? 5000 : 3000));
      }
    }
    if (this.stopping) throw new Error("stopping");
    this.logger.error(
      `dead-lettering ${message.topic}@${message.partition}:${message.offset}: ${String(lastError)}`,
    );
    await this.dlt.publish({
      topic: `${message.topic}.dlt`,
      key: message.key ?? "",
      value: message.value,
      headers: {
        ...message.headers,
        "dlt-reason": String(lastError).slice(0, 500),
        "dlt-source": `${message.topic}/${message.partition}@${message.offset}`,
        "dlt-consumer": options.groupId,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.streams].map((s) => s.close().catch(() => undefined)));
    await Promise.allSettled(this.running);
    await this.dlt.onModuleDestroy();
  }
}
