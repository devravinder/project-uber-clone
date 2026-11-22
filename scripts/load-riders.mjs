import { call, main, parseArgs, percentile, pool, randomPoint, requireUp, sleep } from "./lib.mjs";

const options = parseArgs(process.argv.slice(2), {
  count: 20,
  prefix: "l",
  lat: 12.9716,
  lng: 77.5946,
  spread: 0.01,
  concurrency: 10,
  wait: 60,
  keep: false,
});

await main(async () => {
  await requireUp("rider", "pricing", "trip", "matching");
  await call("rider", "/admin/seed", {
    method: "POST",
    body: { count: options.count, prefix: options.prefix },
  });
  const riders = Array.from(
    { length: options.count },
    (_, i) => `${options.prefix}${String(i + 1).padStart(3, "0")}`,
  );
  const hotspot = { lat: options.lat, lng: options.lng };

  // Leftovers from an earlier run would answer 409 ACTIVE_TRIP_EXISTS.
  for (const r of riders) {
    const t = (await call("trip", `/riders/${r}/active-trip`)).body?.trip;
    if (t && t.status === "requested")
      await call("rider", `/rides/${t.id}/cancel`, { method: "POST", user: r, body: {} });
  }

  const trips = [];
  const surges = [];
  await pool(riders.length, options.concurrency, async (i) => {
    const rider = riders[i];
    const pickup = randomPoint(hotspot, options.spread);
    const dropoff = randomPoint(hotspot, options.spread * 8);
    const q = await call("rider", "/rides/estimate", {
      method: "POST",
      user: rider,
      body: { pickup, dropoff },
    });
    if (q.status !== 200) return console.warn(`${rider}: estimate ${q.status} ${q.body?.code}`);
    surges.push(q.body.surge);
    const t = await call("rider", "/rides", {
      method: "POST",
      user: rider,
      body: { quoteId: q.body.id },
    });
    if (t.status >= 300) return console.warn(`${rider}: request ${t.status} ${t.body?.code}`);
    trips.push({ rider, id: t.body.id, requestedAt: Date.now() });
  });
  console.log(
    `${trips.length} rides requested; surge seen by riders: first ${surges[0]}, last ${surges.at(-1)}, max ${Math.max(...surges)}`,
  );

  const matchMs = [];
  const final = new Map();
  const deadline = Date.now() + options.wait * 1000;
  while (Date.now() < deadline && final.size < trips.length) {
    for (const t of trips) {
      if (final.has(t.id)) continue;
      const trip = (await call("trip", `/trips/${t.id}`)).body;
      if (trip.status !== "requested") {
        final.set(t.id, trip.status);
        if (trip.matchedAt) matchMs.push(Date.parse(trip.matchedAt) - Date.parse(trip.requestedAt));
      }
    }
    await sleep(500);
  }
  const counts = {};
  for (const s of final.values()) counts[s] = (counts[s] ?? 0) + 1;
  counts.still_requested = trips.length - final.size;
  console.log("outcome", JSON.stringify(counts));
  if (matchMs.length) {
    console.log(
      `time to match: p50 ${percentile(matchMs, 50)} ms, p95 ${percentile(matchMs, 95)} ms, max ${Math.max(...matchMs)} ms`,
    );
  }
  if (!options.keep) {
    for (const t of trips) {
      if (final.get(t.id) === undefined)
        await call("rider", `/rides/${t.id}/cancel`, { method: "POST", user: t.rider, body: {} });
    }
  }
});
