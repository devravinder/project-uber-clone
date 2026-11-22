import { call, CITY, km, main, parseArgs, randomPoint, requireUp, sleep, towards } from "./lib.mjs";

const options = parseArgs(process.argv.slice(2), {
  count: 30,
  prefix: "s",
  tick: 1000,
  // Distance per tick; 0.15 km per second is a fast-forward city.
  speed: 0.15,
  accept: 0.9,
  seconds: 0,
});

const center = { lat: (CITY.minLat + CITY.maxLat) / 2, lng: (CITY.minLng + CITY.maxLng) / 2 };
const stats = { accepted: 0, declined: 0, completed: 0, cancelledOnUs: 0, wentOnlineAgain: 0 };
let stopping = false;

async function online(d) {
  const r = await call("driver", `/drivers/${d.id}/online`, {
    method: "PUT",
    user: d.id,
    body: d.pos,
  });
  if (r.status !== 200) throw new Error(`${d.id} could not go online: ${r.body?.code}`);
}

async function step(d) {
  if (d.trip) {
    const fresh = (await call("trip", `/trips/${d.trip.id}`)).body;
    if (!fresh || ["cancelled", "no_drivers"].includes(fresh.status)) {
      stats.cancelledOnUs++;
      d.trip = null;
    } else d.trip = fresh;
  }
  const target = d.trip ? (d.trip.status === "in_progress" ? d.trip.dropoff : d.trip.pickup) : null;
  d.pos = target ? towards(d.pos, target, options.speed) : randomPoint(d.pos, 0.0008);
  const loc = await call("driver", `/drivers/${d.id}/location`, {
    method: "PUT",
    user: d.id,
    body: d.pos,
  });
  // Redis lost us (restart or heartbeat expiry): go online again, like a real app would.
  if (loc.status === 409 && loc.body?.code === "DRIVER_OFFLINE") {
    stats.wentOnlineAgain++;
    await online(d);
  }
  if (d.trip && target && km(d.pos, target) < 0.03) {
    const next = { matched: "arrive", arrived: "start", in_progress: "complete" }[d.trip.status];
    if (next) {
      const r = await call("trip", `/trips/${d.trip.id}/${next}`, { method: "POST", user: d.id });
      if (r.status === 200) d.trip = r.body.status === "completed" ? null : r.body;
      if (next === "complete" && r.status === 200) stats.completed++;
    }
    return;
  }
  if (d.trip?.status === "arrived") {
    const r = await call("trip", `/trips/${d.trip.id}/start`, { method: "POST", user: d.id });
    if (r.status === 200) d.trip = r.body;
    return;
  }
  if (!d.trip) {
    const offer = (await call("matching", "/offers/current", { user: d.id })).body?.offer;
    if (!offer) return;
    if (Math.random() < options.accept) {
      const r = await call("matching", `/offers/${offer.tripId}/accept`, {
        method: "POST",
        user: d.id,
      });
      if (r.status === 200) {
        d.trip = r.body;
        stats.accepted++;
      }
    } else {
      await call("matching", `/offers/${offer.tripId}/decline`, { method: "POST", user: d.id });
      stats.declined++;
    }
  }
}

await main(async () => {
  await requireUp("driver", "matching", "trip");
  await call("driver", "/admin/seed", {
    method: "POST",
    body: { count: options.count, prefix: options.prefix },
  });
  const drivers = Array.from({ length: options.count }, (_, i) => ({
    id: `${options.prefix}${String(i + 1).padStart(3, "0")}`,
    pos: randomPoint(center, 0.09),
    trip: null,
  }));
  for (const d of drivers) {
    const active = (await call("trip", `/drivers/${d.id}/active-trip`)).body?.trip;
    d.trip = active ?? null;
    await online(d);
  }
  console.log(
    `${drivers.length} drivers online (${drivers[0].id}..${drivers.at(-1).id}). Ctrl+C to stop.`,
  );
  process.on("SIGINT", () => (stopping = true));
  const started = Date.now();
  let lastReport = Date.now();
  while (!stopping && (!options.seconds || Date.now() - started < options.seconds * 1000)) {
    const tickStart = Date.now();
    await Promise.all(
      drivers.map((d) => step(d).catch((e) => console.warn(`${d.id}: ${e.message}`))),
    );
    if (Date.now() - lastReport > 10_000) {
      lastReport = Date.now();
      const busy = drivers.filter((d) => d.trip).length;
      console.log(
        `${new Date().toISOString().slice(11, 19)} busy ${busy}/${drivers.length}`,
        JSON.stringify(stats),
      );
    }
    await sleep(Math.max(0, options.tick - (Date.now() - tickStart)));
  }
  for (const d of drivers.filter((x) => !x.trip)) {
    await call("driver", `/drivers/${d.id}/offline`, { method: "PUT", user: d.id }).catch(
      () => undefined,
    );
  }
  console.log("stopped", JSON.stringify(stats));
});
