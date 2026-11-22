import { Body, Controller, Get, Inject, Param, Put, Query } from "@nestjs/common";
import { cityPointSchema } from "@apps/contracts";
import { CurrentUser, fail, parse, parseLimit } from "@apps/kit";
import { z } from "zod";
import { DriverStore } from "./driver.store.js";
import { DriversService } from "./drivers.service.js";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  vehicle: z.string().trim().min(1).max(30),
});

const nearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().positive().max(20).default(3),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// Drivers change only their own state: the path id must be the caller.
function ownDriver(id: string, user: string): void {
  if (id !== user) fail(403, "NOT_YOUR_DRIVER", `X-User ${user} cannot act as driver ${id}`);
}

@Controller("drivers")
export class DriversController {
  constructor(
    @Inject(DriversService) private readonly drivers: DriversService,
    @Inject(DriverStore) private readonly store: DriverStore,
  ) {}

  @Get()
  list(@Query("limit") limit: unknown, @Query("after") after: string | undefined) {
    return this.drivers.list(parseLimit(limit, 50, 200), after || undefined);
  }

  @Get("nearby")
  async nearby(@Query() query: unknown) {
    const q = parse(nearbySchema, query);
    return { items: await this.store.nearby({ lat: q.lat, lng: q.lng }, q.radiusKm, q.limit) };
  }

  @Get("online")
  async online(@Query("limit") limit: unknown) {
    return { items: await this.store.online(parseLimit(limit, 500, 2000)) };
  }

  @Get(":id")
  view(@Param("id") id: string) {
    return this.drivers.view(id);
  }

  @Put(":id")
  upsert(@Param("id") id: string, @CurrentUser() user: string, @Body() body: unknown) {
    ownDriver(id, user);
    const input = parse(profileSchema, body);
    return this.drivers.upsertProfile(id, input.name, input.vehicle);
  }

  @Put(":id/online")
  goOnline(@Param("id") id: string, @CurrentUser() user: string, @Body() body: unknown) {
    ownDriver(id, user);
    return this.drivers.goOnline(id, parse(cityPointSchema, body));
  }

  @Put(":id/offline")
  offline(@Param("id") id: string, @CurrentUser() user: string) {
    ownDriver(id, user);
    return this.drivers.goOffline(id);
  }

  @Put(":id/location")
  location(@Param("id") id: string, @CurrentUser() user: string, @Body() body: unknown) {
    ownDriver(id, user);
    return this.drivers.updateLocation(id, parse(cityPointSchema, body));
  }
}
