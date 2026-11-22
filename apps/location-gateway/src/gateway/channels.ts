import { Inject, Injectable, Logger } from "@nestjs/common";
import { Redis } from "@apps/kit";

type Listener = (message: string) => void;

// Subscribes to a Redis channel while at least one local socket needs it.
@Injectable()
export class Channels {
  private readonly logger = new Logger(Channels.name);
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(@Inject(Redis) private readonly redis: Redis) {}

  get subscribed(): number {
    return this.listeners.size;
  }

  async add(channel: string, listener: Listener): Promise<void> {
    let set = this.listeners.get(channel);
    if (set) {
      set.add(listener);
      return;
    }
    set = new Set([listener]);
    this.listeners.set(channel, set);
    try {
      const sub = await this.redis.subscriber();
      await sub.subscribe(channel, (message) => {
        for (const l of this.listeners.get(channel) ?? []) l(message);
      });
    } catch (error) {
      this.logger.warn(`subscribe ${channel} failed: ${String(error)}`);
    }
  }

  async remove(channel: string, listener: Listener): Promise<void> {
    const set = this.listeners.get(channel);
    if (!set) return;
    set.delete(listener);
    if (set.size > 0) return;
    this.listeners.delete(channel);
    try {
      await (await this.redis.subscriber()).unsubscribe(channel);
    } catch (error) {
      this.logger.warn(`unsubscribe ${channel} failed: ${String(error)}`);
    }
  }
}
