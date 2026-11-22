# Uber clone

A learning project for ride-hailing system design: drivers stream their location, riders get a fare with surge pricing, a matcher offers the trip to the nearest driver one at a time, and the rider watches the driver move live.

## What it teaches

- Geo search on live data: Redis GEO, heartbeats with a TTL, a sweeper
- Matching without double assignment: atomic reservations, durable timers in Redis, per-trip locks, two instances
- A trip state machine: optimistic locking, partial unique indexes, the quote as an idempotency key, a transactional outbox
- Surge pricing per geohash cell from Kafka events, with graceful degradation
- Real-time push across server instances: WebSocket, Redis pub/sub, Kafka broadcast groups

## Services

| Service          | Port       | Owns                                                         |
| ---------------- | ---------- | ------------------------------------------------------------ |
| rider-service    | 7201       | Rider profiles and the rider-facing ride API                 |
| driver-service   | 7202       | Driver profiles, live location (Redis GEO), availability     |
| matching-service | 7203, 7213 | Matching jobs and offers with timeouts                       |
| trip-service     | 7204       | Trips and their state machine, trip events through an outbox |
| pricing-service  | 7205       | Quotes and surge per geohash cell                            |
| location-gateway | 7206, 7216 | WebSocket push of driver locations, offers and trip updates  |
| web              | 5320       | Rider, driver and lab views on a city map                    |

## Quick start

```bash
pnpm install --offline
pnpm start:pods
pnpm start:services
pnpm simulate          # optional: 30 robot drivers that drive and accept on their own
```

Then open `http://localhost:5320` in two browser tabs: "I am a driver" in one (click the map, "Go online here"), "I am a rider" in the other (click pickup, click dropoff, "Get estimate", "Request ride"). Demo riders and drivers are created on the first visit. Step-by-step: [Try it in the browser](docs/HOW-TO-RUN.md#try-it-in-the-browser).

## Docs

- [How to run](docs/HOW-TO-RUN.md): commands, ports, scripts, failure drills
- [Architecture](docs/architecture.md): services, keys, state machines, sequences
- [Decisions](docs/DECISIONS.md): every choice with what was rejected
- [Interview questions](docs/INTERVIEW-QUESTIONS.md)
- [Tasks](docs/TASKS.md): what was built and how it was verified
