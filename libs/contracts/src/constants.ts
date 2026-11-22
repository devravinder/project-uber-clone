// No login: the caller names itself; the web app has a rider and driver switcher.
export const USER_HEADER = "x-user";

export const EVENT_ID_HEADER = "event-id";
export const EVENT_TYPE_HEADER = "event-type";

export const TOPICS = {
  tripEvents: "ub.trip-events",
} as const;

export const dltOf = (topic: string) => `${topic}.dlt`;

// Redis pub/sub channels: live, lossy data that is not worth a Kafka record.
export const CHANNELS = {
  driverLocation: (driverId: string) => `ub:loc:${driverId}`,
  driverInbox: (driverId: string) => `ub:driver:${driverId}`,
} as const;

// Same rule for riders and drivers; ids double as usernames.
export const USER_ID_PATTERN = /^[a-z0-9_]{3,20}$/;

export const SERVICE_PORTS = {
  rider: 7201,
  driver: 7202,
  matching: 7203,
  trip: 7204,
  pricing: 7205,
  gateway: 7206,
} as const;

// Demo city: a 22 km square; drivers, riders and the map stay inside it.
export const CITY = {
  name: "Demo City",
  center: { lat: 12.9716, lng: 77.5946 },
  minLat: 12.8716,
  maxLat: 13.0716,
  minLng: 77.4946,
  maxLng: 77.6946,
} as const;

// Fares are integer minor units (paise, cents) so sums never drift.
export const FARE = {
  currency: "INR",
  baseMinor: 5000,
  perKmMinor: 1200,
  perMinMinor: 200,
  minimumMinor: 8000,
  avgSpeedKmh: 24,
} as const;

// Precision 5: cells of about 4.9 x 4.9 km, a few dozen in the city.
export const SURGE_CELL_PRECISION = 5;
