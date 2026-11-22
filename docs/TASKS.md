# Tasks

One commit per task, made once its checks pass. `[x]` done and verified, `[~]` partly done (the line says what is missing), `[ ]` not started.

| #   | Task                                                                    | Status  |
| --- | ----------------------------------------------------------------------- | ------- |
| 1   | Scaffold: workspace, kit, contracts, infra, six services with `/health` | done    |
| 2   | driver-service: locations in Redis GEO, nearby search, reservations     | done    |
| 3   | pricing-service: quotes and surge per geohash cell                      | done    |
| 4   | trip-service and rider-service: trip state machine, outbox, ride API    | planned |
| 5   | matching-service: offers with timeouts, no double assignment            | planned |
| 6   | location-gateway: live location and trip updates over WebSocket         | planned |
| 7   | Web app: rider, driver and lab screens on a city map                    | planned |
| 8   | Simulator, load scripts, failure scenarios, architecture docs           | planned |

## Task 1: scaffold

- [x] pnpm workspace with `libs/kit` (config, Redis, Kafka, outbox, switches, `/health`, HTTP client) and `libs/contracts` (events, REST shapes, geo helpers)
- [x] Compose file: Postgres 5455, Redis 6401, Kafka 9205, topic `ub.trip-events` with 3 partitions and its `.dlt`
- [x] One database and role per service with a database (riders, drivers, trips); `REVOKE CONNECT` from `PUBLIC`
- [x] Six NestJS services start and answer `/health`; matching-service and location-gateway also start a second instance (7213, 7216)
- [x] First Prisma migrations applied, including the partial unique indexes on `trips`
- [x] Docs, skills and `http/health.http`

Verified: `pnpm install --offline`, `pnpm start:pods`, all eight instances answer `/health` with their Postgres and Redis checks.

## Task 2: driver-service

- [x] Profiles in Postgres (`PUT /drivers/:id`, cursor list, idempotent `POST /admin/seed`)
- [x] Online, location and offline as Lua scripts over the state hash, the heartbeat key and two GEO sets
- [x] `GET /drivers/nearby` with `GEOSEARCH` on available drivers only; `GET /drivers/online` for the map
- [x] Internal reserve, assign and release, each checked against the trip id that holds the driver
- [x] Sweeper: expired heartbeat → offline, offer past `offerUntil` → available
- [x] Location updates publish to `ub:loc:<driverId>`
- [~] Trip-event consumer (release on `TripCompleted`, `TripCancelled`, `TripNoDrivers`) is wired; it is checked end to end in Task 4, when trip-service produces events

Verified: `http/driver.http` passes twice (29 requests). A scenario script checked the rest: 20 parallel reservations of one driver give exactly one winner; a 1 s offer is freed by the sweeper in about 3 s; a silent driver with a 5 s heartbeat goes offline after about 6 s; `redis-cli SUBSCRIBE ub:loc:<id>` receives the location JSON; with Redis stopped a location update answers 503 `REDIS_UNAVAILABLE` in 9 ms and `/health` answers 503.

## Task 3: pricing-service

- [x] `POST /quotes`: haversine distance, duration at 24 km/h, base + per km + per minute, minimum fare, whole-unit rounding
- [x] Quotes saved in Redis with a 120 s TTL; `GET /quotes/:id` answers 404 `QUOTE_NOT_FOUND` once expired
- [x] Demand per geohash cell and minute from `TripRequested` events, deduped by event id in the same Lua script
- [x] Supply from driver-service nearby search; on failure the quote answers with `supply: null` and no surge
- [x] `GET /surge`, `GET /surge/cells`, switches `surgeEnabled`, `forceSurge`, `surgeWindowMinutes`, `surgeMax`, `quoteTtlSeconds`, `supplyRadiusKm`

Verified: `http/pricing.http` passes twice (16 requests). A scenario script sent 7 `TripRequested` events through Kafka (one duplicate): demand rose by exactly 6, and with 2 drivers nearby the surge was 3.0 (capped). With driver-service stopped a quote answered 201 in 8 ms with surge 1.0. A 10 s quote answered 404 after 11 s. `geohashEncode(57.64911, 10.40744, 11)` gives the reference value `u4pruydqqvj`.
