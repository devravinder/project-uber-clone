import { Inject, Injectable } from "@nestjs/common";
import { CHANNELS, type GatewayMessage, type Trip } from "@apps/contracts";
import type { WebSocket } from "ws";
import { Channels } from "./channels.js";

export type Role = "rider" | "driver";
const LIVE = new Set(["matched", "arrived", "in_progress"]);

type Watch = { driverId: string; listener: (message: string) => void };

// Who is connected to this instance, and which driver each rider is watching.
@Injectable()
export class Sessions {
  private readonly riders = new Map<string, Set<WebSocket>>();
  private readonly drivers = new Map<string, Set<WebSocket>>();
  private readonly inboxes = new Map<string, (message: string) => void>();
  private readonly watches = new Map<string, Watch>();
  readonly stats = { messagesOut: 0, locationsForwarded: 0, tripPushes: 0, offersForwarded: 0 };

  constructor(@Inject(Channels) private readonly channels: Channels) {}

  counts() {
    return {
      riders: this.riders.size,
      drivers: this.drivers.size,
      watches: this.watches.size,
      channels: this.channels.subscribed,
    };
  }

  private map(role: Role) {
    return role === "rider" ? this.riders : this.drivers;
  }

  async join(role: Role, user: string, socket: WebSocket): Promise<void> {
    const map = this.map(role);
    const set = map.get(user) ?? new Set<WebSocket>();
    set.add(socket);
    map.set(user, set);
    if (role === "driver" && !this.inboxes.has(user)) {
      // Offers come raw from matching-service; forward without parsing.
      const listener = (message: string) => {
        this.stats.offersForwarded++;
        this.sendRaw("driver", user, message);
      };
      this.inboxes.set(user, listener);
      await this.channels.add(CHANNELS.driverInbox(user), listener);
    }
  }

  async leave(role: Role, user: string, socket: WebSocket): Promise<void> {
    const map = this.map(role);
    const set = map.get(user);
    if (!set) return;
    set.delete(socket);
    if (set.size > 0) return;
    map.delete(user);
    if (role === "driver") {
      const listener = this.inboxes.get(user);
      this.inboxes.delete(user);
      if (listener) await this.channels.remove(CHANNELS.driverInbox(user), listener);
    } else {
      await this.unwatch(user);
    }
  }

  // A rider sees their driver's location only while the trip is live.
  async onTrip(trip: Trip): Promise<void> {
    const message = JSON.stringify({ type: "trip", trip } satisfies GatewayMessage);
    if (this.sendRaw("rider", trip.riderId, message)) this.stats.tripPushes++;
    if (trip.driverId && this.sendRaw("driver", trip.driverId, message)) this.stats.tripPushes++;
    if (!this.riders.has(trip.riderId)) return;
    if (trip.driverId && LIVE.has(trip.status)) await this.watch(trip.riderId, trip.driverId);
    else await this.unwatch(trip.riderId);
  }

  private async watch(riderId: string, driverId: string): Promise<void> {
    const current = this.watches.get(riderId);
    if (current?.driverId === driverId) return;
    if (current) await this.unwatch(riderId);
    const listener = (message: string) => {
      if (this.sendRaw("rider", riderId, message)) this.stats.locationsForwarded++;
    };
    this.watches.set(riderId, { driverId, listener });
    await this.channels.add(CHANNELS.driverLocation(driverId), listener);
  }

  private async unwatch(riderId: string): Promise<void> {
    const current = this.watches.get(riderId);
    if (!current) return;
    this.watches.delete(riderId);
    await this.channels.remove(CHANNELS.driverLocation(current.driverId), current.listener);
  }

  send(role: Role, user: string, message: GatewayMessage): boolean {
    return this.sendRaw(role, user, JSON.stringify(message));
  }

  private sendRaw(role: Role, user: string, message: string): boolean {
    const set = this.map(role).get(user);
    if (!set) return false;
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
        this.stats.messagesOut++;
      }
    }
    return true;
  }
}
