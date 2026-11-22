import { baseEnvSchema } from "@apps/kit";
import { z } from "zod";

export const pricingEnvSchema = baseEnvSchema.extend({ DRIVER_URL: z.url() });
export type PricingConfig = z.infer<typeof pricingEnvSchema>;

export const PRICING_SWITCHES = {
  surgeEnabled: true,
  surgeWindowMinutes: 5,
  surgeMax: 3,
  // Above 0, every quote uses this multiplier; the lab shows surge with it.
  forceSurge: 0,
  quoteTtlSeconds: 120,
  supplyRadiusKm: 3,
};
