import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { cityPointSchema, quoteRequestSchema } from "@apps/contracts";
import { CurrentUser, parse, parseLimit } from "@apps/kit";
import { z } from "zod";
import { PricingService } from "./pricing.service.js";

const pointQuery = z
  .object({ lat: z.coerce.number(), lng: z.coerce.number() })
  .pipe(cityPointSchema);

@Controller()
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Post("quotes")
  create(@CurrentUser() rider: string, @Body() body: unknown) {
    const input = parse(quoteRequestSchema, body);
    return this.pricing.quote(rider, input.pickup, input.dropoff);
  }

  @Get("quotes/:id")
  get(@Param("id") id: string) {
    return this.pricing.get(id);
  }

  @Get("surge")
  surge(@Query() query: unknown) {
    return this.pricing.surgeAt(parse(pointQuery, query));
  }

  @Get("surge/cells")
  async cells(@Query("limit") limit: unknown) {
    return { items: await this.pricing.activeCells(parseLimit(limit, 20, 50)) };
  }
}
