import {
  call,
  CITY,
  main,
  parseArgs,
  percentile,
  pool,
  randomPoint,
  requireUp,
  sleep,
} from "./lib.mjs";

const options = parseArgs(process.argv.slice(2), {
  drivers: 200,
  seconds: 15,
  concurrency: 50,
  prefix: "p",
});
const center = { lat: (CITY.minLat + CITY.maxLat) / 2, lng: (CITY.minLng + CITY.maxLng) / 2 };

await main(async () => {
  await requireUp("driver");
  await call("driver", "/admin/seed", {
    method: "POST",
    body: { count: options.drivers, prefix: options.prefix },
  });
  const drivers = Array.from({ length: options.drivers }, (_, i) => ({
    id: `${options.prefix}${String(i + 1).padStart(3, "0")}`,
    pos: randomPoint(center, 0.09),
  }));
  await pool(drivers.length, 20, async (i) => {
    const d = drivers[i];
    await call("driver", `/drivers/${d.id}/online`, { method: "PUT", user: d.id, body: d.pos });
  });
  console.log(
    `${drivers.length} drivers online; sending locations for ${options.seconds} s with ${options.concurrency} in flight`,
  );

  const latencies = [];
  const errors = {};
  const end = Date.now() + options.seconds * 1000;
  let next = 0;
  const worker = async () => {
    while (Date.now() < end) {
      const d = drivers[next++ % drivers.length];
      d.pos = randomPoint(d.pos, 0.0005);
      const r = await call("driver", `/drivers/${d.id}/location`, {
        method: "PUT",
        user: d.id,
        body: d.pos,
      });
      if (r.status === 200) latencies.push(r.ms);
      else errors[r.body?.code ?? r.status] = (errors[r.body?.code ?? r.status] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  await sleep(1100);
  const stats = (await call("driver", "/admin/stats")).body;
  const rate = Math.round(latencies.length / options.seconds);
  console.log(`${latencies.length} location writes, ${rate} per second`);
  console.log(
    `latency p50 ${percentile(latencies, 50).toFixed(1)} ms, p95 ${percentile(latencies, 95).toFixed(1)} ms, p99 ${percentile(latencies, 99).toFixed(1)} ms`,
  );
  if (Object.keys(errors).length) console.log("errors", JSON.stringify(errors));
  console.log(
    `driver-service: ${stats.online} online, ${stats.locationWrites.perSecond} writes/s over its last 10 s`,
  );
  await pool(drivers.length, 20, async (i) => {
    await call("driver", `/drivers/${drivers[i].id}/offline`, {
      method: "PUT",
      user: drivers[i].id,
    });
  });
});
