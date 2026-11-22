import { Inject, Injectable } from "@nestjs/common";
import type { Page, RiderProfile } from "@apps/contracts";
import { fail } from "@apps/kit";
import { PrismaService } from "../prisma.service.js";

const toProfile = (row: { id: string; name: string; createdAt: Date }): RiderProfile => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class RidersService {
  // Riders are never deleted, so a positive answer can be cached for the process lifetime.
  private readonly known = new Set<string>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(id: string): Promise<RiderProfile> {
    const row = await this.prisma.rider.findUnique({ where: { id } });
    if (!row) fail(404, "RIDER_NOT_FOUND", `rider ${id} does not exist`);
    this.known.add(id);
    return toProfile(row);
  }

  async requireExists(id: string): Promise<void> {
    if (!this.known.has(id)) await this.get(id);
  }

  async upsert(id: string, name: string): Promise<RiderProfile> {
    const row = await this.prisma.rider.upsert({
      where: { id },
      create: { id, name },
      update: { name },
    });
    this.known.add(id);
    return toProfile(row);
  }

  async list(limit: number, after: string | undefined): Promise<Page<RiderProfile>> {
    const rows = await this.prisma.rider.findMany({
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
      return { id: `${prefix}${n}`, name: `Rider ${n}` };
    });
    const { count: created } = await this.prisma.rider.createMany({ data, skipDuplicates: true });
    return { created, total: await this.prisma.rider.count() };
  }
}
