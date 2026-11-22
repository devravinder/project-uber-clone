import { CITY } from "./constants.js";

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

// Great-circle distance; the demo uses it instead of road routing.
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

// Interleaves longitude and latitude bits; a shared prefix means a nearby area.
export function geohashEncode({ lat, lng }: LatLng, precision: number): string {
  const latRange: [number, number] = [-90, 90];
  const lngRange: [number, number] = [-180, 180];
  let hash = "";
  let bits = 0;
  let value = 0;
  let evenBit = true;
  while (hash.length < precision) {
    const range = evenBit ? lngRange : latRange;
    const coord = evenBit ? lng : lat;
    const mid = (range[0] + range[1]) / 2;
    value <<= 1;
    if (coord >= mid) {
      value |= 1;
      range[0] = mid;
    } else {
      range[1] = mid;
    }
    evenBit = !evenBit;
    if (++bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

export type CellBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export function geohashBounds(hash: string): CellBounds {
  const lat: [number, number] = [-90, 90];
  const lng: [number, number] = [-180, 180];
  let evenBit = true;
  for (const ch of hash) {
    const value = BASE32.indexOf(ch);
    if (value < 0) throw new Error(`invalid geohash ${hash}`);
    for (let bit = 4; bit >= 0; bit--) {
      const range = evenBit ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((value >> bit) & 1) range[0] = mid;
      else range[1] = mid;
      evenBit = !evenBit;
    }
  }
  return { minLat: lat[0], maxLat: lat[1], minLng: lng[0], maxLng: lng[1] };
}

export function inCity({ lat, lng }: LatLng): boolean {
  return lat >= CITY.minLat && lat <= CITY.maxLat && lng >= CITY.minLng && lng <= CITY.maxLng;
}

// Moves at most `stepKm` towards `to`; the simulator and the web driver use it.
export function stepTowards(from: LatLng, to: LatLng, stepKm: number): LatLng {
  const distance = haversineKm(from, to);
  if (distance <= stepKm || distance === 0) return { ...to };
  const f = stepKm / distance;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}
