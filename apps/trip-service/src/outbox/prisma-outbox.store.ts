import { Inject, Injectable } from "@nestjs/common";
import type { OutboxRow, OutboxStore } from "@apps/kit";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class PrismaOutboxStore implements OutboxStore {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // The lease hides claimed rows from other instances; SKIP LOCKED avoids waiting on them.
  async claim(limit: number, leaseMs: number): Promise<OutboxRow[]> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE outbox SET locked_until = now() + (${leaseMs}::double precision * interval '1 millisecond')
      WHERE id IN (
        SELECT id FROM outbox
        WHERE sent_at IS NULL AND next_attempt_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, topic, key, type, payload, attempts`;
    // RETURNING has no order guarantee; publish oldest first.
    return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { sentAt: new Date(), lockedUntil: null },
    });
  }

  async markFailed(id: string, attempts: number, retryAt: Date): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { attempts, nextAttemptAt: retryAt, lockedUntil: null },
    });
  }
}
