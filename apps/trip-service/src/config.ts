import { baseEnvSchema } from "@apps/kit";
import { z } from "zod";

export const tripEnvSchema = baseEnvSchema.extend({ PRICING_URL: z.url() });
export type TripConfig = z.infer<typeof tripEnvSchema>;

export const TRIP_SWITCHES = {
  outboxPaused: false,
  // A trip still unmatched after this long ends as no_drivers, even if matching is down.
  requestTimeoutSeconds: 180,
  // Lab: a pause between read and update makes racing writers collide on the version.
  transitionDelayMs: 0,
};
