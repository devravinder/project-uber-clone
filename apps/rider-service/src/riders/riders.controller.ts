import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { CurrentUser, fail, parse, parseLimit } from "@apps/kit";
import { z } from "zod";
import { RidesService } from "../rides/rides.service.js";
import { RidersService } from "./riders.service.js";

const profileSchema = z.object({ name: z.string().trim().min(1).max(60) });
const seedSchema = z.object({
  count: z.number().int().min(1).max(5000).default(20),
  prefix: z
    .string()
    .regex(/^[a-z_]{1,10}$/)
    .default("r"),
});

@Controller("riders")
export class RidersController {
  constructor(@Inject(RidersService) private readonly riders: RidersService) {}

  @Get()
  list(@Query("limit") limit: unknown, @Query("after") after?: string) {
    return this.riders.list(parseLimit(limit, 50, 200), after || undefined);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.riders.get(id);
  }

  @Put(":id")
  upsert(@Param("id") id: string, @CurrentUser() user: string, @Body() body: unknown) {
    if (id !== user) fail(403, "NOT_YOUR_PROFILE", `X-User ${user} cannot edit rider ${id}`);
    return this.riders.upsert(id, parse(profileSchema, body).name);
  }
}

@Controller("admin")
export class AdminController {
  constructor(
    @Inject(RidersService) private readonly riders: RidersService,
    @Inject(RidesService) private readonly rides: RidesService,
  ) {}

  // Idempotent: existing ids are skipped.
  @Post("seed")
  @HttpCode(200)
  seed(@Body() body: unknown) {
    const input = parse(seedSchema, body ?? {});
    return this.riders.seed(input.count, input.prefix);
  }

  @Get("stats")
  stats() {
    return this.rides.stats;
  }
}
