import { Inject, Injectable } from "@nestjs/common";
import { type Page, TOPICS, type Trip, type TripEvent, type TripEventType } from "@apps/contracts";
import { fail, newId, sleep, Switches } from "@apps/kit";
import { Prisma, type Trip as TripRow } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma.service.js";
import { QuoteClient } from "./quote.client.js";
import { type Actor, forbidden, RULES, type TripAction } from "./state-machine.js";
import { toTrip } from "./trip.mapper.js";

type Tx = Prisma.TransactionClient;
const ACTIVE = ["requested", "matched", "arrived", "in_progress"] as const;
const MAX_ATTEMPTS = 3;

export type Extra = { driverId?: string; reason?: string };

@Injectable()
export class TripsService {
  readonly stats = { created: 0, replayed: 0, transitions: 0, versionConflicts: 0 };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QuoteClient) private readonly quotes: QuoteClient,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  // The quote id is the idempotency key: retrying a request returns the same trip.
  async create(riderId: string, quoteId: string): Promise<{ trip: Trip; replayed: boolean }> {
    const existing = await this.prisma.trip.findUnique({ where: { quoteId } });
    if (existing) return this.replay(existing, riderId);
    await this.refuseIfActive(riderId);
    const quote = await this.quotes.get(quoteId);
    if (quote.riderId !== riderId)
      fail(403, "QUOTE_NOT_YOURS", `quote ${quoteId} belongs to another rider`);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.trip.create({
          data: {
            id: `t${newId()}`,
            riderId,
            pickupLat: quote.pickup.lat,
            pickupLng: quote.pickup.lng,
            dropoffLat: quote.dropoff.lat,
            dropoffLng: quote.dropoff.lng,
            distanceKm: quote.distanceKm,
            fareMinor: quote.fareMinor,
            currency: quote.currency,
            surge: quote.surge,
            quoteId,
          },
        });
        await this.writeEvent(tx, "TripRequested", created);
        return created;
      });
      this.stats.created++;
      return { trip: toTrip(row), replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a race: the same quote (a retry) or another active trip.
      const again = await this.prisma.trip.findUnique({ where: { quoteId } });
      if (again) return this.replay(again, riderId);
      await this.refuseIfActive(riderId);
      throw error;
    }
  }

  private replay(row: TripRow, riderId: string): { trip: Trip; replayed: boolean } {
    if (row.riderId !== riderId) fail(409, "QUOTE_USED", `quote ${row.quoteId} was already used`);
    this.stats.replayed++;
    return { trip: toTrip(row), replayed: true };
  }

  private async refuseIfActive(riderId: string): Promise<void> {
    const active = await this.activeFor({ riderId });
    if (active) {
      fail(409, "ACTIVE_TRIP_EXISTS", `rider ${riderId} already has trip ${active.id}`, {
        activeTripId: active.id,
      });
    }
  }

  async get(id: string): Promise<Trip> {
    const row = await this.prisma.trip.findUnique({ where: { id } });
    if (!row) fail(404, "TRIP_NOT_FOUND", `trip ${id} does not exist`);
    return toTrip(row);
  }

  async activeFor(where: { riderId: string } | { driverId: string }): Promise<Trip | null> {
    const row = await this.prisma.trip.findFirst({
      where: { ...where, status: { in: [...ACTIVE] } },
      orderBy: { id: "desc" },
    });
    return row ? toTrip(row) : null;
  }

  async history(
    where: { riderId: string } | { driverId: string },
    limit: number,
    before: string | undefined,
  ): Promise<Page<Trip>> {
    const rows = await this.prisma.trip.findMany({
      where: { ...where, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(toTrip);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
  }

  async cancelBy(id: string, userId: string, reason: string | undefined) {
    const row = await this.prisma.trip.findUnique({ where: { id } });
    if (!row) fail(404, "TRIP_NOT_FOUND", `trip ${id} does not exist`);
    const kind = row.riderId === userId ? "rider" : row.driverId === userId ? "driver" : null;
    if (!kind) fail(403, "NOT_YOUR_TRIP", `${userId} is neither rider nor driver of trip ${id}`);
    return this.transition(id, "cancel", { kind, id: userId }, { reason });
  }

  // Optimistic locking: update only the version we read, else re-read and decide again.
  async transition(
    id: string,
    action: TripAction,
    actor: Actor,
    extra: Extra = {},
  ): Promise<{ trip: Trip; changed: boolean }> {
    const rule = RULES[action];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await this.prisma.trip.findUnique({ where: { id } });
      if (!row) fail(404, "TRIP_NOT_FOUND", `trip ${id} does not exist`);
      const denied = forbidden(action, row, actor);
      if (denied) fail(403, denied, `${actor.kind} ${actor.id} cannot ${action} trip ${id}`);
      if (row.status === rule.to) {
        if (action === "assign" && row.driverId !== extra.driverId) {
          fail(409, "TRIP_ALREADY_MATCHED", `trip ${id} already has driver ${row.driverId}`, {
            status: row.status,
            driverId: row.driverId,
          });
        }
        return { trip: toTrip(row), changed: false };
      }
      if (!rule.from.includes(row.status)) {
        fail(409, "INVALID_TRANSITION", `cannot ${action} a trip that is ${row.status}`, {
          status: row.status,
        });
      }
      const delay = this.switches.get<number>("transitionDelayMs");
      if (delay > 0) await sleep(Math.min(delay, 5000));
      const updated = await this.apply(row, action, actor, extra);
      if (updated) {
        this.stats.transitions++;
        return { trip: toTrip(updated), changed: true };
      }
      this.stats.versionConflicts++;
    }
    return fail(409, "VERSION_CONFLICT", `trip ${id} kept changing; try again`);
  }

  private async apply(row: TripRow, action: TripAction, actor: Actor, extra: Extra) {
    const rule = RULES[action];
    const now = new Date();
    const data: Prisma.TripUpdateManyMutationInput & { driverId?: string } = { status: rule.to };
    if (action === "assign") Object.assign(data, { driverId: extra.driverId, matchedAt: now });
    if (action === "arrive") data.arrivedAt = now;
    if (action === "start") data.startedAt = now;
    if (action === "complete") data.endedAt = now;
    if (action === "cancel") {
      Object.assign(data, {
        endedAt: now,
        cancelledBy: actor.kind,
        cancelReason: extra.reason ?? null,
      });
    }
    if (action === "noDrivers") {
      Object.assign(data, {
        endedAt: now,
        cancelledBy: "system",
        cancelReason: "no driver accepted",
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.trip.updateMany({
          where: { id: row.id, version: row.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (count === 0) return null;
        const fresh = await tx.trip.findUniqueOrThrow({ where: { id: row.id } });
        await this.writeEvent(tx, rule.event, fresh);
        return fresh;
      });
    } catch (error) {
      // The partial unique index: this driver is already on another active trip.
      if (action === "assign" && isUniqueViolation(error)) {
        fail(409, "DRIVER_BUSY", `driver ${extra.driverId} already has an active trip`);
      }
      throw error;
    }
  }

  private async writeEvent(tx: Tx, type: TripEventType, row: TripRow): Promise<void> {
    const eventId = newId();
    const event: TripEvent = {
      eventId,
      occurredAt: new Date().toISOString(),
      type,
      trip: toTrip(row),
    };
    await tx.outbox.create({
      data: {
        id: eventId,
        topic: TOPICS.tripEvents,
        key: row.id,
        type,
        payload: JSON.stringify(event),
      },
    });
  }

  async staleRequested(olderThan: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.trip.findMany({
      where: { status: "requested", requestedAt: { lt: olderThan } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: limit,
    });
    return rows.map((r) => r.id);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
