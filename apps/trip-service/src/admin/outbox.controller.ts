import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

type Counts = { pending: bigint; sent: bigint; failed: bigint; oldest_ms: number | null };

@Controller("admin/outbox")
export class OutboxController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // pending includes failed rows waiting for a retry.
  @Get()
  async outbox() {
    const [row] = await this.prisma.$queryRaw<Counts[]>`
      SELECT
        count(*) FILTER (WHERE sent_at IS NULL) AS pending,
        count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
        count(*) FILTER (WHERE sent_at IS NULL AND attempts > 0) AS failed,
        (extract(epoch FROM now() - min(created_at) FILTER (WHERE sent_at IS NULL)) * 1000)::float8
          AS oldest_ms
      FROM outbox`;
    return {
      pending: Number(row!.pending),
      sent: Number(row!.sent),
      failed: Number(row!.failed),
      oldestPendingAgeMs: Math.round(row!.oldest_ms ?? 0),
    };
  }
}
