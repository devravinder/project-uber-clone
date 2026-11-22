import {
  FARE,
  type GatewayMessage,
  haversineKm,
  type LatLng,
  type Quote,
  type Trip,
} from "@apps/contracts";
import { useEffect, useState } from "react";
import { api, money } from "../api.js";
import { GATEWAYS, useGateway, useNow, usePoll, useTabState } from "../hooks.js";
import { CityMap } from "./city-map.js";
import { useAction } from "./toast.js";

const CANCELLABLE = new Set(["requested", "matched", "arrived"]);
const STATUS_TEXT: Record<string, string> = {
  requested: "Looking for a driver...",
  matched: "Driver on the way",
  arrived: "Driver has arrived",
  in_progress: "On the trip",
  completed: "Trip completed",
  cancelled: "Trip cancelled",
  no_drivers: "No driver accepted",
};

export function RiderView() {
  const run = useAction();
  const now = useNow();
  const [rider, setRider] = useTabState("rider", "");
  const [gateway, setGateway] = useTabState("riderGateway", Object.values(GATEWAYS)[0]!);
  const [pickup, setPickup] = useTabState<LatLng | null>("pickup", null);
  const [dropoff, setDropoff] = useTabState<LatLng | null>("dropoff", null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driverAt, setDriverAt] = useState<LatLng | null>(null);
  const riders = usePoll(() => api.riders(), 10_000);
  const drivers = usePoll(() => api.onlineDrivers(), 2000);
  const cells = usePoll(() => api.surgeCells(), 5000);

  useEffect(() => {
    setTrip(null);
    setDriverAt(null);
    if (rider)
      void api.currentRide(rider).then(
        (r) => setTrip(r.trip),
        () => undefined,
      );
  }, [rider]);

  const socket = useGateway(gateway, rider, "rider", (message: GatewayMessage) => {
    if (message.type === "trip" && message.trip.riderId === rider) setTrip(message.trip);
    if (message.type === "location") setDriverAt({ lat: message.lat, lng: message.lng });
  });

  const pick = (at: LatLng) => {
    if (!pickup || (pickup && dropoff)) {
      setPickup(at);
      setDropoff(null);
    } else setDropoff(at);
    setQuote(null);
  };

  const live = trip && ["matched", "arrived", "in_progress"].includes(trip.status);
  const etaMin =
    live && driverAt && trip.status === "matched"
      ? Math.max(1, Math.round((haversineKm(driverAt, trip.pickup) / FARE.avgSpeedKmh) * 60))
      : null;
  const quoteLeft = quote ? Math.max(0, Math.round((Date.parse(quote.expiresAt) - now) / 1000)) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <CityMap
        drivers={drivers.data?.items ?? []}
        cells={cells.data?.items ?? []}
        pickup={trip ? trip.pickup : pickup}
        dropoff={trip ? trip.dropoff : dropoff}
        tracked={live ? driverAt : null}
        trackedLabel={trip?.driverId ?? ""}
        onPick={trip && CANCELLABLE.has(trip.status) ? undefined : pick}
        hint={trip ? undefined : !pickup || dropoff ? "click: set pickup" : "click: set dropoff"}
      />
      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="rider">
            Rider
          </label>
          <div className="flex gap-2">
            <select
              id="rider"
              className="input flex-1"
              value={rider}
              onChange={(e) => setRider(e.target.value)}
            >
              <option value="">choose a rider</option>
              {riders.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} - {r.name}
                </option>
              ))}
            </select>
            {riders.data?.items.length === 0 && (
              <button
                className="btn-light"
                onClick={() =>
                  void run(() => api.seedRiders(20), "20 riders added").then(riders.refresh)
                }
              >
                Seed riders
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <select
              className="input"
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              aria-label="gateway"
            >
              {Object.entries(GATEWAYS).map(([name, url]) => (
                <option key={url} value={url}>
                  {name}
                </option>
              ))}
            </select>
            {socket.connected ? `live via ${socket.instance}` : rider ? "connecting..." : ""}
          </div>
        </div>

        {!trip || (!CANCELLABLE.has(trip.status) && trip.status !== "in_progress") ? (
          <div className="card flex flex-col gap-2">
            <div className="text-sm">
              Pickup: {pickup ? `${pickup.lat}, ${pickup.lng}` : "-"}
              <br />
              Dropoff: {dropoff ? `${dropoff.lat}, ${dropoff.lng}` : "-"}
            </div>
            <button
              className="btn"
              disabled={!rider || !pickup || !dropoff}
              onClick={() =>
                void run(() => api.estimate(rider, pickup!, dropoff!)).then((q) => q && setQuote(q))
              }
            >
              Get estimate
            </button>
            {quote && (
              <div className="rounded-md bg-slate-50 p-3 text-sm" data-testid="quote">
                <div className="text-xl font-semibold">
                  {money(quote.fareMinor, quote.currency)}
                </div>
                <div>
                  {quote.distanceKm} km, about {Math.round(quote.durationMin)} min
                  {quote.surge > 1 && (
                    <span className="ml-2 rounded bg-orange-100 px-1 text-orange-700">
                      surge x{quote.surge}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  demand {quote.demand}, free drivers {quote.supply ?? "unknown"}, cell {quote.cell}
                  ; price held {quoteLeft} s
                </div>
                <button
                  className="btn mt-2 w-full"
                  disabled={quoteLeft === 0}
                  onClick={() =>
                    void run(() => api.requestRide(rider, quote.id), "Ride requested").then((t) => {
                      if (t) {
                        setTrip(t);
                        setQuote(null);
                      }
                    })
                  }
                >
                  Request ride
                </button>
              </div>
            )}
          </div>
        ) : null}

        {trip && (
          <div className="card flex flex-col gap-2" data-testid="trip">
            <div className="text-lg font-semibold">{STATUS_TEXT[trip.status]}</div>
            <div className="text-sm text-slate-600">
              {trip.driverId ? `Driver ${trip.driverId}` : "No driver yet"}
              {etaMin !== null && ` - about ${etaMin} min away`}
            </div>
            <div className="text-sm">
              {money(trip.fareMinor, trip.currency)}{" "}
              {trip.surge > 1 ? `(surge x${trip.surge})` : ""}, {trip.distanceKm} km
            </div>
            <div className="text-xs text-slate-500">
              trip {trip.id}, version {trip.version}
              {trip.cancelledBy && `, cancelled by ${trip.cancelledBy}`}
            </div>
            {CANCELLABLE.has(trip.status) && (
              <button
                className="btn-light"
                onClick={() =>
                  void run(() => api.cancelRide(rider, trip.id), "Ride cancelled").then(
                    (t) => t && setTrip(t),
                  )
                }
              >
                Cancel ride
              </button>
            )}
            {!CANCELLABLE.has(trip.status) && trip.status !== "in_progress" && (
              <button className="btn-light" onClick={() => setTrip(null)}>
                New ride
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
