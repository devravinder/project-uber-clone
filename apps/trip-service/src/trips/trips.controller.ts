import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { assignTripSchema, cancelTripSchema, createTripSchema } from "@apps/contracts";
import { CurrentUser, parse, parseLimit } from "@apps/kit";
import type { Response } from "express";
import type { TripAction } from "./state-machine.js";
import { TripsService } from "./trips.service.js";

@Controller("trips")
export class TripsController {
  constructor(@Inject(TripsService) private readonly trips: TripsService) {}

  // 201 for a new trip, 200 when the same quote is sent again.
  @Post()
  async create(
    @CurrentUser() rider: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { trip, replayed } = await this.trips.create(
      rider,
      parse(createTripSchema, body).quoteId,
    );
    res.status(replayed ? 200 : 201);
    return trip;
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.trips.get(id);
  }

  @Post(":id/arrive")
  @HttpCode(200)
  arrive(@Param("id") id: string, @CurrentUser() driver: string) {
    return this.driverStep(id, "arrive", driver);
  }

  @Post(":id/start")
  @HttpCode(200)
  start(@Param("id") id: string, @CurrentUser() driver: string) {
    return this.driverStep(id, "start", driver);
  }

  @Post(":id/complete")
  @HttpCode(200)
  complete(@Param("id") id: string, @CurrentUser() driver: string) {
    return this.driverStep(id, "complete", driver);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  async cancel(@Param("id") id: string, @CurrentUser() user: string, @Body() body: unknown) {
    const { reason } = parse(cancelTripSchema, body ?? {});
    return (await this.trips.cancelBy(id, user, reason)).trip;
  }

  private async driverStep(id: string, action: TripAction, driver: string) {
    return (await this.trips.transition(id, action, { kind: "driver", id: driver })).trip;
  }
}

@Controller()
export class TripQueriesController {
  constructor(@Inject(TripsService) private readonly trips: TripsService) {}

  @Get("riders/:id/trips")
  riderTrips(
    @Param("id") id: string,
    @Query("limit") limit: unknown,
    @Query("before") before?: string,
  ) {
    return this.trips.history({ riderId: id }, parseLimit(limit), before || undefined);
  }

  @Get("drivers/:id/trips")
  driverTrips(
    @Param("id") id: string,
    @Query("limit") limit: unknown,
    @Query("before") before?: string,
  ) {
    return this.trips.history({ driverId: id }, parseLimit(limit), before || undefined);
  }

  // Always 200: "no active trip" is a normal answer, not an error.
  @Get("riders/:id/active-trip")
  async riderActive(@Param("id") id: string) {
    return { trip: await this.trips.activeFor({ riderId: id }) };
  }

  @Get("drivers/:id/active-trip")
  async driverActive(@Param("id") id: string) {
    return { trip: await this.trips.activeFor({ driverId: id }) };
  }
}

@Controller("internal/trips")
export class InternalTripsController {
  constructor(@Inject(TripsService) private readonly trips: TripsService) {}

  @Post(":id/assign")
  @HttpCode(200)
  async assign(@Param("id") id: string, @Body() body: unknown) {
    const { driverId } = parse(assignTripSchema, body);
    return (
      await this.trips.transition(id, "assign", { kind: "system", id: "matching" }, { driverId })
    ).trip;
  }

  @Post(":id/no-drivers")
  @HttpCode(200)
  async noDrivers(@Param("id") id: string) {
    return (await this.trips.transition(id, "noDrivers", { kind: "system", id: "matching" })).trip;
  }
}
