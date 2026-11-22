import { baseEnvSchema } from "@apps/kit";
import { z } from "zod";

export const riderEnvSchema = baseEnvSchema.extend({ PRICING_URL: z.url(), TRIP_URL: z.url() });
export type RiderConfig = z.infer<typeof riderEnvSchema>;
