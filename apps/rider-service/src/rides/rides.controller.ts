import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { cancelTripSchema, createTripSchema, quoteRequestSchema } from "@apps/contracts";
import { CurrentUser, parse, parseLimit } from "@apps/kit";
import type { Response } from "express";
import { RidesService } from "./rides.service.js";

// The rider-facing API: the web app never calls pricing-service or trip-service directly.
@Controller("rides")
export class RidesController {
  constructor(@Inject(RidesService) private readonly rides: RidesService) {}

  @Post("estimate")
  @HttpCode(200)
  estimate(@CurrentUser() rider: string, @Body() body: unknown) {
    const input = parse(quoteRequestSchema, body);
    return this.rides.estimate(rider, input.pickup, input.dropoff);
  }

  @Post()
  async request(
    @CurrentUser() rider: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { status, body: trip } = await this.rides.request(
      rider,
      parse(createTripSchema, body).quoteId,
    );
    res.status(status);
    return trip;
  }

  @Get("current")
  current(@CurrentUser() rider: string) {
    return this.rides.current(rider);
  }

  @Get()
  history(
    @CurrentUser() rider: string,
    @Query("limit") limit: unknown,
    @Query("before") before?: string,
  ) {
    return this.rides.history(rider, parseLimit(limit), before || undefined);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() rider: string, @Param("id") id: string, @Body() body: unknown) {
    return this.rides.cancel(rider, id, parse(cancelTripSchema, body ?? {}).reason);
  }
}
