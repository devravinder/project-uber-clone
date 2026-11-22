import { z } from "zod";
import { haversineKm, inCity } from "./geo.js";

export type Page<T> = { items: T[]; nextCursor: string | null };

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const cityPointSchema = latLngSchema.refine(inCity, "point must be inside the demo city");

export type RiderProfile = { id: string; name: string; createdAt: string };
export type DriverProfile = { id: string; name: string; vehicle: string; createdAt: string };

export const DRIVER_STATUSES = ["offline", "available", "offered", "on_trip"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export type DriverState = {
  id: string;
  status: DriverStatus;
  tripId: string | null;
  lat: number | null;
  lng: number | null;
  updatedAt: number | null;
  // False when the heartbeat expired; the sweeper takes such drivers offline.
  alive: boolean;
};

export type NearbyDriver = { driverId: string; lat: number; lng: number; distanceKm: number };
export type OnlineDriver = { driverId: string; status: DriverStatus; lat: number; lng: number };

export const MIN_TRIP_KM = 0.3;

export const quoteRequestSchema = z
  .object({ pickup: cityPointSchema, dropoff: cityPointSchema })
  .refine((q) => haversineKm(q.pickup, q.dropoff) >= MIN_TRIP_KM, {
    message: `pickup and dropoff must be at least ${MIN_TRIP_KM} km apart`,
  });

export type Quote = {
  id: string;
  riderId: string;
  pickup: z.infer<typeof latLngSchema>;
  dropoff: z.infer<typeof latLngSchema>;
  distanceKm: number;
  durationMin: number;
  surge: number;
  fareMinor: number;
  currency: string;
  cell: string;
  demand: number;
  // Null when driver-service did not answer: surge falls back to 1.0.
  supply: number | null;
  createdAt: string;
  expiresAt: string;
};

export type SurgeCell = {
  cell: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  demand: number;
  supply: number | null;
  surge: number;
};

export const TRIP_STATUSES = [
  "requested",
  "matched",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_drivers",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = [
  "requested",
  "matched",
  "arrived",
  "in_progress",
];

export const tripSchema = z.object({
  id: z.string(),
  riderId: z.string(),
  driverId: z.string().nullable(),
  status: z.enum(TRIP_STATUSES),
  pickup: latLngSchema,
  dropoff: latLngSchema,
  distanceKm: z.number(),
  fareMinor: z.number().int(),
  currency: z.string(),
  surge: z.number(),
  quoteId: z.string(),
  version: z.number().int(),
  cancelReason: z.string().nullable(),
  cancelledBy: z.enum(["rider", "driver", "system"]).nullable(),
  requestedAt: z.string(),
  matchedAt: z.string().nullable(),
  arrivedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type Trip = z.infer<typeof tripSchema>;

export const createTripSchema = z.object({ quoteId: z.string().min(1).max(40) });
export const cancelTripSchema = z.object({ reason: z.string().max(200).optional() });
export const assignTripSchema = z.object({ driverId: z.string().min(1) });

export type Offer = {
  tripId: string;
  driverId: string;
  riderId: string;
  pickup: z.infer<typeof latLngSchema>;
  dropoff: z.infer<typeof latLngSchema>;
  fareMinor: number;
  currency: string;
  distanceToPickupKm: number;
  attempt: number;
  expiresAt: string;
};

// What the matcher does for one trip: lets a rider see who is asked.
export type MatchingProgress = {
  tripId: string;
  state: "searching" | "offered" | "done";
  radiusKm: number | null;
  attempt: number;
  offerDriver: string | null;
  offerDistanceKm: number | null;
  offerExpiresAt: string | null;
  declined: string[];
  startedAt: string | null;
};

export type OfferClosedReason = "accepted" | "declined" | "expired" | "cancelled";

// What location-gateway pushes over the WebSocket.
export type GatewayMessage =
  | { type: "hello"; user: string; role: "rider" | "driver"; instance: string }
  | { type: "location"; driverId: string; lat: number; lng: number; at: number }
  | { type: "trip"; trip: Trip }
  | { type: "offer"; offer: Offer }
  | { type: "offer-closed"; tripId: string; reason: OfferClosedReason };
