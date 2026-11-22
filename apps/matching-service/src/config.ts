import { baseEnvSchema } from "@apps/kit";
import { z } from "zod";

export const matchingEnvSchema = baseEnvSchema.extend({ DRIVER_URL: z.url(), TRIP_URL: z.url() });
export type MatchingConfig = z.infer<typeof matchingEnvSchema>;

export const MATCHING_SWITCHES = {
  offerTimeoutMs: 10_000,
  matchTimeoutMs: 60_000,
  startRadiusKm: 2,
  radiusStepKm: 2,
  maxRadiusKm: 6,
  retryDelayMs: 2000,
  // Lab: stops the ticker; jobs pile up in mt:due as if matchers were down.
  paused: false,
};
