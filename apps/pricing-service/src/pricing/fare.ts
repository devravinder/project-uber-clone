import { FARE, haversineKm, type LatLng } from "@apps/contracts";

const round1 = (n: number) => Math.round(n * 10) / 10;

export function tripEstimate(pickup: LatLng, dropoff: LatLng) {
  const distanceKm = round1(haversineKm(pickup, dropoff));
  const durationMin = round1((distanceKm / FARE.avgSpeedKmh) * 60);
  return { distanceKm, durationMin };
}

// Rounded to whole currency units, as a rider would see it on a receipt.
export function fareMinor(distanceKm: number, durationMin: number, surge: number): number {
  const raw = FARE.baseMinor + FARE.perKmMinor * distanceKm + FARE.perMinMinor * durationMin;
  const base = Math.max(FARE.minimumMinor, raw);
  return Math.round((base * surge) / 100) * 100;
}

// Recent demand against drivers available now; see ADR-009 for the formula.
export function surgeMultiplier(demand: number, supply: number | null, max: number): number {
  if (supply === null) return 1;
  const ratio = demand / Math.max(supply, 1);
  if (ratio <= 1) return 1;
  return Math.min(max, round1(1 + (ratio - 1) * 0.5));
}
