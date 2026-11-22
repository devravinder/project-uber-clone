import type { Trip } from "@apps/contracts";
import type { Trip as TripRow } from "../generated/prisma/client.js";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    riderId: row.riderId,
    driverId: row.driverId,
    status: row.status,
    pickup: { lat: row.pickupLat, lng: row.pickupLng },
    dropoff: { lat: row.dropoffLat, lng: row.dropoffLng },
    distanceKm: row.distanceKm,
    fareMinor: row.fareMinor,
    currency: row.currency,
    surge: row.surge,
    quoteId: row.quoteId,
    version: row.version,
    cancelReason: row.cancelReason,
    cancelledBy: row.cancelledBy,
    requestedAt: row.requestedAt.toISOString(),
    matchedAt: iso(row.matchedAt),
    arrivedAt: iso(row.arrivedAt),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}
