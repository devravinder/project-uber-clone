export const URLS = {
  rider: process.env.RIDER_API ?? "http://localhost:7201",
  driver: process.env.DRIVER_API ?? "http://localhost:7202",
  matching: process.env.MATCHING_API ?? "http://localhost:7203",
  trip: process.env.TRIP_API ?? "http://localhost:7204",
  pricing: process.env.PRICING_API ?? "http://localhost:7205",
};

// Same box as CITY in libs/contracts; scripts stay dependency-free.
export const CITY = { minLat: 12.8716, maxLat: 13.0716, minLng: 77.4946, maxLng: 77.6946 };

export class Fail extends Error {}

// Returns { status, body, ms }; throws Fail only when nothing answers.
export async function call(service, path, { method = "GET", user, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-user"] = user;
  const started = performance.now();
  let response;
  try {
    response = await fetch(`${URLS[service]}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Fail(
      `${service} is not reachable at ${URLS[service]} (${error.cause?.code ?? error.message})`,
    );
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, ms: performance.now() - started };
}

export async function requireUp(...services) {
  const down = [];
  for (const service of services) {
    try {
      const { status } = await call(service, "/health");
      if (status >= 500) down.push(`${service} answered ${status} on /health`);
    } catch (error) {
      down.push(error.message);
    }
  }
  if (down.length) {
    throw new Fail(
      `Cannot run:\n  - ${down.join("\n  - ")}\nStart them with "pnpm start:services".`,
    );
  }
}

export function parseArgs(argv, defaults) {
  const options = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") || arg === "--") continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) options[name] = true;
    else {
      options[name] = typeof defaults[name] === "number" ? Number(next) : next;
      i++;
    }
  }
  return options;
}

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

// Runs task(i) for i in 0..total-1 with at most `concurrency` in flight.
export async function pool(total, concurrency, task) {
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const i = next++;
      await task(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function randomPoint(center, spreadDeg) {
  const lat = center.lat + (Math.random() - 0.5) * 2 * spreadDeg;
  const lng = center.lng + (Math.random() - 0.5) * 2 * spreadDeg;
  return {
    lat: Number(Math.min(CITY.maxLat - 0.001, Math.max(CITY.minLat + 0.001, lat)).toFixed(5)),
    lng: Number(Math.min(CITY.maxLng - 0.001, Math.max(CITY.minLng + 0.001, lng)).toFixed(5)),
  };
}

const toRad = (d) => (d * Math.PI) / 180;
export function km(a, b) {
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

export function towards(from, to, stepKm) {
  const d = km(from, to);
  if (d <= stepKm) return { ...to };
  const f = stepKm / d;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}

export async function main(run) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Fail ? error.message : error);
    process.exitCode = 1;
  }
}
