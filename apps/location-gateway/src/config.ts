import { baseEnvSchema } from "@apps/kit";
import { z } from "zod";

export const gatewayEnvSchema = baseEnvSchema.extend({ TRIP_URL: z.url() });
export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;
