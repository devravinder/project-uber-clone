import { Inject, Injectable } from "@nestjs/common";
import type { DriverProfile, DriverState, LatLng, Page } from "@apps/contracts";
import { fail, Switches } from "@apps/kit";
import { PrismaService } from "../prisma.service.js";
import { DriverStore } from "./driver.store.js";
import { LocationRate } from "./location-rate.js";

const VEHICLES = ["Hatchback", "Sedan", "SUV", "Auto", "Bike"];

const toProfile = (row: { id: string; name: string; vehicle: string; createdAt: Date }) => ({
  id: row.id,
  name: row.name,
  vehicle: row.vehicle,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class DriversService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DriverStore) private readonly store: DriverStore,
    @Inject(Switches) private readonly switches: Switches,
    @Inject(LocationRate) private readonly rate: LocationRate,
  ) {}

  private get ttlSeconds(): number {
    // Redis rejects EX 0, and a few seconds is the shortest useful heartbeat.
    return Math.max(5, Math.round(this.switches.get<number>("heartbeatTtlSeconds")));
  }

  async profile(id: string): Promise<DriverProfile> {
    const row = await this.prisma.driver.findUnique({ where: { id } });
    if (!row) fail(404, "DRIVER_NOT_FOUND", `driver ${id} does not exist`);
    return toProfile(row);
  }

  async upsertProfile(id: string, name: string, vehicle: string): Promise<DriverProfile> {
    const row = await this.prisma.driver.upsert({
      where: { id },
      create: { id, name, vehicle },
      update: { name, vehicle },
    });
    return toProfile(row);
  }

  async list(limit: number, after: string | undefined): Promise<Page<DriverProfile>> {
    const rows = await this.prisma.driver.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(toProfile);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
  }

  async seed(count: number, prefix: string): Promise<{ created: number; total: number }> {
    const data = Array.from({ length: count }, (_, i) => {
      const n = String(i + 1).padStart(3, "0");
      return { id: `${prefix}${n}`, name: `Driver ${n}`, vehicle: VEHICLES[i % VEHICLES.length]! };
    });
    const { count: created } = await this.prisma.driver.createMany({ data, skipDuplicates: true });
    return { created, total: await this.prisma.driver.count() };
  }

  async goOnline(id: string, at: LatLng): Promise<DriverState> {
    await this.profile(id);
    await this.store.goOnline(id, at, this.ttlSeconds);
    return this.store.state(id);
  }

  // Hot path: no database read, Redis decides whether the driver is online.
  async updateLocation(id: string, at: LatLng): Promise<{ status: string }> {
    const status = await this.store.updateLocation(id, at, this.ttlSeconds);
    if (status === "offline")
      fail(409, "DRIVER_OFFLINE", `driver ${id} is offline; go online first`);
    this.rate.record();
    return { status };
  }

  async goOffline(id: string): Promise<DriverState> {
    const status = await this.store.goOffline(id);
    if (status !== "offline") {
      fail(409, "DRIVER_BUSY", `driver ${id} is ${status}; finish or decline the trip first`, {
        status,
      });
    }
    return this.store.state(id);
  }

  async view(id: string): Promise<DriverProfile & { state: DriverState }> {
    const [profile, state] = await Promise.all([this.profile(id), this.store.state(id)]);
    return { ...profile, state };
  }
}
