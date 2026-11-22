import {
  type DriverProfile,
  type DriverState,
  type LatLng,
  type Offer,
  type OnlineDriver,
  type Page,
  type Quote,
  type RiderProfile,
  type SurgeCell,
  type Trip,
  USER_HEADER,
} from "@apps/contracts";

export type ServiceName =
  "rider" | "driver" | "matching" | "matching-2" | "trip" | "pricing" | "gateway" | "gateway-2";

export const SERVICES: ServiceName[] = [
  "rider",
  "driver",
  "matching",
  "matching-2",
  "trip",
  "pricing",
  "gateway",
  "gateway-2",
];

export type Switches = Record<string, string | number | boolean>;
export type TripStep = "arrive" | "start" | "complete";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Init = { method?: string; body?: unknown; user?: string };

async function request<T>(service: ServiceName, path: string, init: Init = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${service}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.user ? { [USER_HEADER]: init.user } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ApiError(0, "NETWORK", `${service}: ${(error as Error).message}`);
  }
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    // The dev proxy answers 502 with an empty body when a service is down.
    const fallback = response.status >= 500 ? "UNREACHABLE" : "HTTP_ERROR";
    throw new ApiError(
      response.status,
      typeof body?.code === "string" ? body.code : fallback,
      typeof body?.message === "string" ? body.message : `${service}: HTTP ${response.status}`,
    );
  }
  return body as T;
}

export type HealthResult = { ok: boolean; status: number; body: Record<string, unknown> | null };

export const api = {
  // A 503 still carries the checks, so the lab can say what is down.
  health: async (service: ServiceName): Promise<HealthResult> => {
    try {
      const response = await fetch(`/api/${service}/health`);
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return { ok: response.ok, status: response.status, body };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  },

  riders: () => request<Page<RiderProfile>>("rider", "/riders?limit=200"),
  seedRiders: (count: number) =>
    request<{ created: number; total: number }>("rider", "/admin/seed", {
      method: "POST",
      body: { count, prefix: "r" },
    }),
  estimate: (rider: string, pickup: LatLng, dropoff: LatLng) =>
    request<Quote>("rider", "/rides/estimate", {
      method: "POST",
      user: rider,
      body: { pickup, dropoff },
    }),
  requestRide: (rider: string, quoteId: string) =>
    request<Trip>("rider", "/rides", { method: "POST", user: rider, body: { quoteId } }),
  currentRide: (rider: string) =>
    request<{ trip: Trip | null }>("rider", "/rides/current", { user: rider }),
  cancelRide: (rider: string, tripId: string) =>
    request<Trip>("rider", `/rides/${tripId}/cancel`, {
      method: "POST",
      user: rider,
      body: { reason: "cancelled in the web app" },
    }),
  rides: (rider: string) => request<Page<Trip>>("rider", "/rides?limit=10", { user: rider }),

  drivers: () => request<Page<DriverProfile>>("driver", "/drivers?limit=200"),
  seedDrivers: (count: number) =>
    request<{ created: number; total: number }>("driver", "/admin/seed", {
      method: "POST",
      body: { count, prefix: "d" },
    }),
  driver: (id: string) =>
    request<DriverProfile & { state: DriverState }>("driver", `/drivers/${id}`),
  goOnline: (id: string, at: LatLng) =>
    request<DriverState>("driver", `/drivers/${id}/online`, { method: "PUT", user: id, body: at }),
  goOffline: (id: string) =>
    request<DriverState>("driver", `/drivers/${id}/offline`, { method: "PUT", user: id }),
  location: (id: string, at: LatLng) =>
    request<{ status: string }>("driver", `/drivers/${id}/location`, {
      method: "PUT",
      user: id,
      body: at,
    }),
  onlineDrivers: () => request<{ items: OnlineDriver[] }>("driver", "/drivers/online"),

  currentOffer: (driver: string) =>
    request<{ offer: Offer | null }>("matching", "/offers/current", { user: driver }),
  accept: (driver: string, tripId: string) =>
    request<Trip>("matching", `/offers/${tripId}/accept`, { method: "POST", user: driver }),
  decline: (driver: string, tripId: string) =>
    request<unknown>("matching", `/offers/${tripId}/decline`, { method: "POST", user: driver }),

  driverTrip: (driver: string) =>
    request<{ trip: Trip | null }>("trip", `/drivers/${driver}/active-trip`),
  tripStep: (driver: string, tripId: string, step: TripStep) =>
    request<Trip>("trip", `/trips/${tripId}/${step}`, { method: "POST", user: driver }),
  cancelAsDriver: (driver: string, tripId: string) =>
    request<Trip>("trip", `/trips/${tripId}/cancel`, {
      method: "POST",
      user: driver,
      body: { reason: "driver cancelled in the web app" },
    }),

  surgeCells: () => request<{ items: SurgeCell[] }>("pricing", "/surge/cells"),

  stats: (service: ServiceName) => request<Record<string, unknown>>(service, "/admin/stats"),
  outbox: () => request<Record<string, number>>("trip", "/admin/outbox"),
  jobs: () =>
    request<{ items: { dueAt: number; job: Record<string, unknown> | null }[] }>(
      "matching",
      "/admin/jobs",
    ),
  switches: (service: ServiceName) => request<Switches>(service, "/admin/switches"),
  setSwitches: (service: ServiceName, patch: Switches) =>
    request<Switches>(service, "/admin/switches", { method: "PUT", body: patch }),
  resetSwitches: (service: ServiceName) =>
    request<Switches>(service, "/admin/switches/reset", { method: "PUT" }),
};

export const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;
