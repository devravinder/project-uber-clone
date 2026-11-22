import {
  CITY,
  type GatewayMessage,
  haversineKm,
  type LatLng,
  type Offer,
  stepTowards,
  type Trip,
} from "@apps/contracts";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, money, type TripStep } from "../api.js";
import { GATEWAYS, useGateway, useNow, usePoll, useTabState } from "../hooks.js";
import { CityMap } from "./city-map.js";
import { Guide } from "./guide.js";
import { useAction, useToast } from "./toast.js";

const HEARTBEAT_MS = 5000;
const DRIVE_TICK_MS = 1000;
// Fast-forward: 100 m per tick, so a 5 km demo trip takes under a minute.
const DRIVE_STEP_KM = 0.1;

const NEXT_STEP: Record<string, { step: TripStep; label: string } | undefined> = {
  matched: { step: "arrive", label: "Arrived at pickup" },
  arrived: { step: "start", label: "Start trip" },
  in_progress: { step: "complete", label: "Complete trip" },
};

export function DriverView() {
  const run = useAction();
  const toast = useToast();
  const now = useNow();
  const [driver, setDriver] = useTabState("driver", "");
  const [gateway, setGateway] = useTabState("driverGateway", Object.values(GATEWAYS)[1]!);
  const [pos, setPos] = useTabState<LatLng>("driverPos", { ...CITY.center });
  const [autoDrive, setAutoDrive] = useTabState("autoDrive", true);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const drivers = usePoll(() => api.drivers(), 10_000);
  const online = usePoll(() => api.onlineDrivers(), 2000);
  const me = usePoll(() => (driver ? api.driver(driver) : Promise.resolve(null)), 2000, [driver]);
  const status = me.data?.state.status ?? "offline";
  const announced = useRef<string | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    if (!driver && drivers.data?.items.length) setDriver(drivers.data.items[0]!.id);
  }, [driver, drivers.data, setDriver]);

  useEffect(() => {
    setOffer(null);
    setTrip(null);
    if (!driver) return;
    void api.driverTrip(driver).then(
      (r) => setTrip(r.trip),
      () => undefined,
    );
    void api.currentOffer(driver).then(
      (r) => setOffer(r.offer),
      () => undefined,
    );
    const known = me.data?.state;
    if (known?.lat && known.lng) setPos({ lat: known.lat, lng: known.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver]);

  const socket = useGateway(gateway, driver, "driver", (message: GatewayMessage) => {
    if (message.type === "offer") {
      setOffer(message.offer);
      // StrictMode briefly opens two sockets in development; announce each trip once.
      if (announced.current !== message.offer.tripId) {
        announced.current = message.offer.tripId;
        toast(`New offer: ${money(message.offer.fareMinor, message.offer.currency)}`);
      }
    }
    if (message.type === "offer-closed") {
      setOffer((o) => (o?.tripId === message.tripId ? null : o));
      if (message.reason !== "accepted") toast(`Offer ${message.reason}`);
    }
    if (message.type === "trip" && message.trip.driverId === driver) {
      setTrip(
        ["completed", "cancelled", "no_drivers"].includes(message.trip.status)
          ? null
          : message.trip,
      );
      if (message.trip.status === "cancelled") toast("The trip was cancelled", "error");
    }
  });

  // Keep the heartbeat alive and, in auto-drive, move towards the pickup or the dropoff.
  useEffect(() => {
    if (!driver || status === "offline") return;
    const target =
      autoDrive && trip
        ? trip.status === "in_progress"
          ? trip.dropoff
          : trip.status === "matched"
            ? trip.pickup
            : null
        : null;
    const tick = async () => {
      const next = target ? stepTowards(posRef.current, target, DRIVE_STEP_KM) : posRef.current;
      setPos(next);
      try {
        await api.location(driver, next);
      } catch (error) {
        if (error instanceof ApiError && error.code === "DRIVER_OFFLINE") {
          toast("driver-service lost this driver (Redis restarted?): go online again", "error");
          void me.refresh();
        }
      }
    };
    const timer = setInterval(() => void tick(), target ? DRIVE_TICK_MS : HEARTBEAT_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, status, autoDrive, trip?.status, trip?.id]);

  const offerLeft = offer ? Math.max(0, Math.round((Date.parse(offer.expiresAt) - now) / 1000)) : 0;
  const next = trip ? NEXT_STEP[trip.status] : undefined;
  const target = trip ? (trip.status === "in_progress" ? trip.dropoff : trip.pickup) : null;
  const distance = target ? haversineKm(pos, target) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <CityMap
        drivers={online.data?.items.filter((d) => d.driverId !== driver) ?? []}
        pickup={offer?.pickup ?? trip?.pickup}
        dropoff={offer?.dropoff ?? trip?.dropoff}
        tracked={pos}
        trackedLabel={driver || "me"}
        onPick={status === "offline" || !trip ? (at) => setPos(at) : undefined}
        hint={
          status === "offline"
            ? "click: choose where to go online"
            : !trip
              ? "click: move"
              : undefined
        }
      />
      <div className="flex flex-col gap-4">
        <Guide
          id="driver"
          title="How to drive"
          steps={[
            { label: "Choose a driver below", done: Boolean(driver) },
            {
              label: "Click the map where you are (the big blue dot moves there)",
              done:
                status !== "offline" || pos.lat !== CITY.center.lat || pos.lng !== CITY.center.lng,
              hint: "Pick a spot close to where the rider will set the pickup: requests go to the nearest free driver within 2-6 km.",
            },
            { label: 'Press "Go online here"', done: status !== "offline" },
            {
              label: "Wait for a ride request",
              done: Boolean(offer) || Boolean(trip),
              hint: 'In the other tab ("I am a rider"), set a pickup near you, get an estimate and request a ride. The offer appears here.',
            },
            { label: 'Press "Accept" within 10 s', done: Boolean(trip) },
            {
              label: 'Drive: "Arrived at pickup", "Start trip", "Complete trip"',
              done: false,
              hint: "With auto-drive on, the blue dot drives itself to the pickup and then the dropoff.",
            },
          ]}
        />
        <div className="card flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="driver">
            Driver
          </label>
          <div className="flex gap-2">
            <select
              id="driver"
              className="input flex-1"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
            >
              {drivers.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} - {d.vehicle}
                </option>
              ))}
            </select>
            {drivers.data?.items.length === 0 && (
              <button
                className="btn-light"
                onClick={() =>
                  void run(() => api.seedDrivers(50), "50 drivers added").then(drivers.refresh)
                }
              >
                Seed drivers
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
            {socket.connected ? `live via ${socket.instance}` : driver ? "connecting..." : ""}
          </div>
          <div className="text-sm">
            Status:{" "}
            <span className="font-semibold" data-testid="driver-status">
              {status}
            </span>
            {me.data?.state.alive === false && status !== "offline" && " (heartbeat expired)"}
          </div>
          <div className="flex gap-2">
            <button
              className="btn flex-1"
              disabled={!driver || status !== "offline"}
              onClick={() => void run(() => api.goOnline(driver, pos), "Online").then(me.refresh)}
            >
              Go online here
            </button>
            <button
              className="btn-light flex-1"
              disabled={!driver || status === "offline"}
              onClick={() => void run(() => api.goOffline(driver), "Offline").then(me.refresh)}
            >
              Go offline
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoDrive}
              onChange={(e) => setAutoDrive(e.target.checked)}
            />
            Auto-drive to the pickup and dropoff
          </label>
        </div>

        {status === "available" && !offer && !trip && (
          <div className="card text-sm" data-testid="waiting">
            <div className="font-semibold">Online and waiting for a request</div>
            <div className="text-slate-600">
              A rider request goes to the nearest free driver. Offers appear here with a 10 s
              countdown. Keep this tab open: it sends your location every 5 s, and after 30 s
              without one you are taken offline.
            </div>
          </div>
        )}

        {offer && (
          <div className="card flex flex-col gap-2 border-amber-400" data-testid="offer">
            <div className="text-lg font-semibold">
              New trip: {money(offer.fareMinor, offer.currency)}
            </div>
            <div className="text-sm">
              Pickup {offer.distanceToPickupKm.toFixed(2)} km away, offer {offer.attempt} for this
              trip
            </div>
            <div className="h-2 w-full rounded bg-slate-200">
              <div
                className="h-2 rounded bg-amber-500"
                style={{ width: `${Math.min(100, offerLeft * 10)}%` }}
              />
            </div>
            <div className="text-xs text-slate-500">{offerLeft} s to answer</div>
            <div className="flex gap-2">
              <button
                className="btn flex-1"
                onClick={() =>
                  void run(() => api.accept(driver, offer.tripId), "Accepted").then((t) => {
                    setOffer(null);
                    if (t) setTrip(t);
                  })
                }
              >
                Accept
              </button>
              <button
                className="btn-light flex-1"
                onClick={() =>
                  void run(() => api.decline(driver, offer.tripId), "Declined").then(() =>
                    setOffer(null),
                  )
                }
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {trip && (
          <div className="card flex flex-col gap-2" data-testid="driver-trip">
            <div className="text-lg font-semibold">Trip {trip.status.replace("_", " ")}</div>
            <div className="text-sm">
              Rider {trip.riderId}, {money(trip.fareMinor, trip.currency)}
              {distance !== null &&
                ` - ${distance.toFixed(2)} km to the ${trip.status === "in_progress" ? "dropoff" : "pickup"}`}
            </div>
            {next && (
              <button
                className="btn"
                onClick={() =>
                  void run(() => api.tripStep(driver, trip.id, next.step)).then(
                    (t) => t && setTrip(t.status === "completed" ? null : t),
                  )
                }
              >
                {next.label}
              </button>
            )}
            {(trip.status === "matched" || trip.status === "arrived") && (
              <button
                className="btn-light"
                onClick={() =>
                  void run(() => api.cancelAsDriver(driver, trip.id), "Trip cancelled").then(() =>
                    setTrip(null),
                  )
                }
              >
                Cancel trip
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
