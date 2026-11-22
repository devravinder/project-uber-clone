import { z } from "zod";
import { tripSchema } from "./api.js";

export const TRIP_EVENT_TYPES = [
  "TripRequested",
  "TripMatched",
  "DriverArrived",
  "TripStarted",
  "TripCompleted",
  "TripCancelled",
  "TripNoDrivers",
] as const;
export type TripEventType = (typeof TRIP_EVENT_TYPES)[number];

// Every event carries the whole trip, so consumers never call back for state.
export const tripEventSchema = z.object({
  eventId: z.string(),
  occurredAt: z.string(),
  type: z.enum(TRIP_EVENT_TYPES),
  trip: tripSchema,
});
export type TripEvent = z.infer<typeof tripEventSchema>;
