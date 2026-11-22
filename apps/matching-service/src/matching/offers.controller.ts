import { Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentUser, parseLimit } from "@apps/kit";
import { JobStore } from "./job.store.js";
import { MatcherService } from "./matcher.service.js";

@Controller("offers")
export class OffersController {
  constructor(@Inject(MatcherService) private readonly matcher: MatcherService) {}

  // Polling fallback for drivers without a WebSocket (the simulator uses it).
  @Get("current")
  async current(@CurrentUser() driver: string) {
    return { offer: await this.matcher.currentOffer(driver) };
  }

  @Post(":tripId/accept")
  @HttpCode(200)
  accept(@Param("tripId") tripId: string, @CurrentUser() driver: string) {
    return this.matcher.accept(tripId, driver);
  }

  @Post(":tripId/decline")
  @HttpCode(200)
  decline(@Param("tripId") tripId: string, @CurrentUser() driver: string) {
    return this.matcher.decline(tripId, driver);
  }
}

@Controller("admin")
export class AdminController {
  constructor(
    @Inject(MatcherService) private readonly matcher: MatcherService,
    @Inject(JobStore) private readonly jobs: JobStore,
  ) {}

  @Get("jobs")
  async list(@Query("limit") limit: unknown) {
    const pending = await this.jobs.pending(parseLimit(limit, 50, 200));
    const items = await Promise.all(
      pending.map(async ({ tripId, dueAt }) => ({ dueAt, job: await this.jobs.get(tripId) })),
    );
    return { items };
  }

  @Get("stats")
  stats() {
    const s = this.matcher.stats;
    return { ...s, avgMatchMs: s.accepted ? Math.round(s.totalMatchMs / s.accepted) : null };
  }
}
