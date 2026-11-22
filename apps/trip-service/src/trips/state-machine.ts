import type { TripEventType, TripStatus } from "@apps/contracts";

export type TripAction = "assign" | "arrive" | "start" | "complete" | "cancel" | "noDrivers";

export type Actor = { kind: "rider" | "driver" | "system"; id: string };

type Rule = { from: TripStatus[]; to: TripStatus; event: TripEventType };

export const RULES: Record<TripAction, Rule> = {
  assign: { from: ["requested"], to: "matched", event: "TripMatched" },
  arrive: { from: ["matched"], to: "arrived", event: "DriverArrived" },
  start: { from: ["arrived"], to: "in_progress", event: "TripStarted" },
  complete: { from: ["in_progress"], to: "completed", event: "TripCompleted" },
  cancel: { from: ["requested", "matched", "arrived"], to: "cancelled", event: "TripCancelled" },
  noDrivers: { from: ["requested"], to: "no_drivers", event: "TripNoDrivers" },
};

type TripView = { status: TripStatus; riderId: string; driverId: string | null };

// An error code, or null when this actor may run this action.
export function forbidden(action: TripAction, trip: TripView, actor: Actor): string | null {
  switch (action) {
    case "assign":
    case "noDrivers":
      return actor.kind === "system" ? null : "INTERNAL_ONLY";
    case "arrive":
    case "start":
    case "complete":
      return actor.kind === "driver" && actor.id === trip.driverId ? null : "NOT_YOUR_TRIP";
    case "cancel":
      if (actor.kind === "rider") return actor.id === trip.riderId ? null : "NOT_YOUR_TRIP";
      if (actor.kind === "driver") return actor.id === trip.driverId ? null : "NOT_YOUR_TRIP";
      return null;
  }
}
