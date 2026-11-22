import { Body, Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { parse } from "@apps/kit";
import { z } from "zod";
import { DriverStore } from "./driver.store.js";

const reserveSchema = z.object({
  tripId: z.string().min(1),
  ttlMs: z.number().int().min(1000).max(120_000),
});
const tripSchema = z.object({ tripId: z.string().min(1) });

// Called by matching-service. A "no" answer is a normal 200, not an error.
@Controller("internal/drivers")
export class InternalController {
  constructor(@Inject(DriverStore) private readonly store: DriverStore) {}

  @Post(":id/reserve")
  @HttpCode(200)
  async reserve(@Param("id") id: string, @Body() body: unknown) {
    const input = parse(reserveSchema, body);
    return { reserved: await this.store.reserve(id, input.tripId, input.ttlMs) };
  }

  @Post(":id/assign")
  @HttpCode(200)
  async assign(@Param("id") id: string, @Body() body: unknown) {
    return { assigned: await this.store.assign(id, parse(tripSchema, body).tripId) };
  }

  @Post(":id/release")
  @HttpCode(200)
  async release(@Param("id") id: string, @Body() body: unknown) {
    return { released: await this.store.release(id, parse(tripSchema, body).tripId) };
  }
}
