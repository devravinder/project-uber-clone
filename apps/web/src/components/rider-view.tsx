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
import { Guide } from "./guide.js";
import { useAction } from "./toast.js";

const CANCELLABLE = new Set(["requested", "matched", "arrived"]);
const ENDED = new Set(["completed", "cancelled", "no_drivers"]);
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
  const searching = trip?.status === "requested";
  const nearby = usePoll(
    () => (pickup && !trip ? api.nearby(pickup) : Promise.resolve(null)),
    2000,
    [pickup?.lat, pickup?.lng, trip?.id],
  );
  const progress = usePoll(
    () => (trip && searching ? api.progress(trip.id) : Promise.resolve(null)),
    1000,
    [trip?.id, searching],
  );

  useEffect(() => {
    if (!rider && riders.data?.items.length) setRider(riders.data.items[0]!.id);
  }, [rider, riders.data, setRider]);

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
    if (!pickup || dropoff) {
      setPickup(at);
      setDropoff(null);
    } else setDropoff(at);
    setQuote(null);
  };

  const live = trip && ["matched", "arrived", "in_progress"].includes(trip.status);

  // The first pushed location can be seconds away; show where the driver is now.
  useEffect(() => {
    if (!live || driverAt || !trip?.driverId) return;
    void api.driver(trip.driverId).then(
      (d) => {
        if (d.state.lat !== null && d.state.lng !== null) {
          setDriverAt((current) => current ?? { lat: d.state.lat!, lng: d.state.lng! });
        }
      },
      () => undefined,
    );
  }, [live, driverAt, trip?.driverId]);
  const etaMin =
    live && driverAt && trip.status === "matched"
      ? Math.max(1, Math.round((haversineKm(driverAt, trip.pickup) / FARE.avgSpeedKmh) * 60))
      : null;
  const quoteLeft = quote ? Math.max(0, Math.round((Date.parse(quote.expiresAt) - now) / 1000)) : 0;
  const freeDrivers = drivers.data?.items.filter((d) => d.status === "available").length ?? 0;
  const p = progress.data;
  const offerLeft = p?.offerExpiresAt
    ? Math.max(0, Math.round((Date.parse(p.offerExpiresAt) - now) / 1000))
    : 0;
  const waited = trip ? Math.round((now - Date.parse(trip.requestedAt)) / 1000) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <CityMap
        drivers={drivers.data?.items ?? []}
        cells={cells.data?.items ?? []}
        pickup={trip ? trip.pickup : pickup}
        dropoff={trip ? trip.dropoff : dropoff}
        tracked={live ? driverAt : null}
        trackedLabel={trip?.driverId ? `your driver ${trip.driverId}` : ""}
        onPick={trip && !ENDED.has(trip.status) ? undefined : pick}
        hint={
          trip && !ENDED.has(trip.status)
            ? undefined
            : !pickup
              ? "click the map: set your pickup (P)"
              : !dropoff
                ? "click the map: set your dropoff (D)"
                : "click the map again to start over with a new pickup"
        }
      />
      <div className="flex flex-col gap-4">
        <Guide
          id="rider"
          title="How to take a ride"
          steps={[
            { label: "Choose a rider below", done: Boolean(rider) },
            {
              label: `At least one driver online (now: ${freeDrivers} free)`,
              done: freeDrivers > 0 || Boolean(trip),
              hint: 'Open a second browser tab, press "I am a driver", click the map near where you will be picked up, then "Go online here". Or run pnpm simulate for 30 robot drivers.',
            },
            {
              label: "Click the map to set your pickup (P)",
              done: Boolean(pickup) || Boolean(trip),
            },
            {
              label: "Click again to set your dropoff (D)",
              done: Boolean(dropoff) || Boolean(trip),
            },
            {
              label: 'Press "Get estimate" to see the price',
              done: Boolean(quote) || Boolean(trip),
            },
            { label: 'Press "Request ride"', done: Boolean(trip) },
            {
              label: "Wait for a driver to accept",
              done: Boolean(trip && !["requested"].includes(trip.status)),
              hint: "The nearest free driver gets a 10 s offer. If you are the driver too, accept it in the driver tab.",
            },
          ]}
        />

        <div className="card flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="rider">
            Rider
          </label>
          <select
            id="rider"
            className="input"
            value={rider}
            onChange={(e) => setRider(e.target.value)}
          >
            {riders.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} - {r.name}
              </option>
            ))}
          </select>
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
            {socket.connected
              ? `live updates via ${socket.instance}`
              : rider
                ? "connecting..."
                : ""}
          </div>
        </div>

        {(!trip || ENDED.has(trip.status)) && (
          <div className="card flex flex-col gap-2">
            <div className="text-sm">
              Pickup: {pickup ? `${pickup.lat}, ${pickup.lng}` : "click the map"}
              <br />
              Dropoff:{" "}
              {dropoff ? `${dropoff.lat}, ${dropoff.lng}` : pickup ? "click the map again" : "-"}
            </div>
            {pickup && nearby.data && (
              <div className="rounded-md bg-slate-50 p-2 text-xs" data-testid="nearby">
                {nearby.data.items.length === 0 ? (
                  <span className="text-red-700">
                    No free driver within 6 km of your pickup. A request would end as "no driver".
                    Put a driver online near P first.
                  </span>
                ) : (
                  <>
                    <div className="mb-1 font-medium">
                      Your request will be offered to these free drivers, nearest first:
                    </div>
                    <ol className="list-decimal pl-5">
                      {nearby.data.items.slice(0, 5).map((d) => (
                        <li key={d.driverId}>
                          {d.driverId} - {d.distanceKm.toFixed(2)} km away
                        </li>
                      ))}
                    </ol>
                    <div className="mt-1 text-slate-500">
                      Each one gets 10 s to accept. The search starts within 2 km and widens to 4
                      and 6 km.
                    </div>
                  </>
                )}
              </div>
            )}
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
                  Price held for {quoteLeft} s. Recent requests here: {quote.demand}, free drivers
                  nearby: {quote.supply ?? "unknown"}.
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
        )}

        {trip && (
          <div className="card flex flex-col gap-2" data-testid="trip">
            <div className="text-lg font-semibold">{STATUS_TEXT[trip.status]}</div>
            {searching && p && (
              <div className="rounded-md bg-amber-50 p-2 text-sm" data-testid="progress">
                {p.state === "offered" ? (
                  <div>
                    Asking <b>{p.offerDriver}</b> ({p.offerDistanceKm?.toFixed(2)} km away):{" "}
                    {offerLeft} s left to accept.
                  </div>
                ) : p.state === "searching" ? (
                  <div>Searching for a free driver within {p.radiusKm} km of your pickup...</div>
                ) : (
                  <div>Matching finished; waiting for the trip update.</div>
                )}
                <div className="text-xs text-slate-600">
                  Drivers asked so far: {p.attempt}
                  {p.declined.length > 0 && `, declined or timed out: ${p.declined.join(", ")}`}.
                  Waited {waited} s of 60.
                </div>
              </div>
            )}
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
              {trip.cancelledBy && `, ended by ${trip.cancelledBy}`}
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
            {ENDED.has(trip.status) && (
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
