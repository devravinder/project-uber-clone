# Tasks

One commit per task, made once its checks pass. `[x]` done and verified, `[~]` partly done (the line says what is missing), `[ ]` not started.

| #   | Task                                                                    | Status |
| --- | ----------------------------------------------------------------------- | ------ |
| 1   | Scaffold: workspace, kit, contracts, infra, six services with `/health` | done   |
| 2   | driver-service: locations in Redis GEO, nearby search, reservations     | done   |
| 3   | pricing-service: quotes and surge per geohash cell                      | done   |
| 4   | trip-service and rider-service: trip state machine, outbox, ride API    | done   |
| 5   | matching-service: offers with timeouts, no double assignment            | done   |
| 6   | location-gateway: live location and trip updates over WebSocket         | done   |
| 7   | Web app: rider, driver and lab screens on a city map                    | done   |
| 8   | Simulator, load scripts, failure scenarios, architecture docs           | done   |

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
- [x] Trip-event consumer releases the driver on `TripCompleted`, `TripCancelled`, `TripNoDrivers` (verified in Task 4)

Verified: `http/driver.http` passes twice (29 requests). A scenario script checked the rest: 20 parallel reservations of one driver give exactly one winner; a 1 s offer is freed by the sweeper in about 3 s; a silent driver with a 5 s heartbeat goes offline after about 6 s; `redis-cli SUBSCRIBE ub:loc:<id>` receives the location JSON; with Redis stopped a location update answers 503 `REDIS_UNAVAILABLE` in 9 ms and `/health` answers 503.

## Task 3: pricing-service

- [x] `POST /quotes`: haversine distance, duration at 24 km/h, base + per km + per minute, minimum fare, whole-unit rounding
- [x] Quotes saved in Redis with a 120 s TTL; `GET /quotes/:id` answers 404 `QUOTE_NOT_FOUND` once expired
- [x] Demand per geohash cell and minute from `TripRequested` events, deduped by event id in the same Lua script
- [x] Supply from driver-service nearby search; on failure the quote answers with `supply: null` and no surge
- [x] `GET /surge`, `GET /surge/cells`, switches `surgeEnabled`, `forceSurge`, `surgeWindowMinutes`, `surgeMax`, `quoteTtlSeconds`, `supplyRadiusKm`

Verified: `http/pricing.http` passes twice (16 requests). A scenario script sent 7 `TripRequested` events through Kafka (one duplicate): demand rose by exactly 6, and with 2 drivers nearby the surge was 3.0 (capped). With driver-service stopped a quote answered 201 in 8 ms with surge 1.0. A 10 s quote answered 404 after 11 s. `geohashEncode(57.64911, 10.40744, 11)` gives the reference value `u4pruydqqvj`.

## Task 4: trip-service and rider-service

- [x] Trips in Postgres with a status enum, a version column and partial unique indexes (one active trip per rider and per driver)
- [x] `POST /trips` from a quote: 201 new, 200 for the same quote again; 409 `ACTIVE_TRIP_EXISTS`, `QUOTE_USED`; 403 `QUOTE_NOT_YOURS`; 410 `QUOTE_EXPIRED`
- [x] State machine: assign, arrive, start, complete, cancel (rider or driver), no-drivers; actor checks; optimistic version with re-read
- [x] Outbox to `ub.trip-events`, one event per transition with the whole trip
- [x] Reaper: trips still requested after `requestTimeoutSeconds` become `no_drivers`
- [x] History and active-trip queries for riders and drivers, cursor pagination
- [x] rider-service: rider profiles and seed, `/rides/estimate`, `/rides`, `/rides/current`, `/rides/:id/cancel`, history; one retry of "request ride" on no answer
- [x] Kit: `callJsonWithStatus` and `relayUpstream` (pass a 4xx through with its code and fields)
- [x] Skills `trip-state-machine` and `pricing-surge` (the pricing skill was missed in Task 3)

Verified: `http/trip.http` (39) and `http/rider.http` (16) pass, and all five request files pass twice in a row (109 requests). A scenario script checked the rest (36 checks): `TripCompleted` and `TripCancelled` reach driver-service through the outbox and Kafka and free the driver; 10 parallel assigns of one trip give exactly one 200; 10 parallel requests with one quote give one trip; a paused relay keeps rows pending and drains in about 250 ms when resumed; with a 3 s timeout the reaper ends an unmatched trip; with trip-service stopped "request ride" answers 503 `TRIPS_UNAVAILABLE` after one retry, and the same quote works once it is back. With `transitionDelayMs = 300` a 10-way race showed 8 version conflicts and one write.

Gotcha: right after driver-service restarts, its consumer group needs about 30 s to rejoin, so the first trip-end event can take that long to free a driver.

## Task 5: matching-service

- [x] A job per `TripRequested` in Redis (`mt:job:<tripId>`), timers in the `mt:due` sorted set, polled every 250 ms by every instance
- [x] One offer at a time to the nearest free driver: reserve in driver-service, publish on `ub:driver:<id>`, `GET /offers/current` as a polling fallback
- [x] Offer timeout, decline, a growing radius (2, 4, 6 km), give up after `matchTimeoutMs` with `no-drivers`
- [x] Accept: driver-service assign, then trip-service assign; 409 `TRIP_GONE` when the trip was cancelled meanwhile; 503 keeps the offer
- [x] Per-trip lock with a token; two instances (7203, 7213) share the work
- [x] `TripCancelled`, `TripNoDrivers` and `TripMatched` close the job; stale `TripRequested` replays are ignored
- [x] Expired offers check trip-service before re-offering
- [x] `GET /admin/jobs`, `GET /admin/stats`, switches for every timing and `paused`

Verified: `http/matching.http` passes twice (26 requests). A scenario script with both instances passed 27 checks: the nearest driver gets the first offer about 250 ms after the request; decline moves to the next driver in about 250 ms; an ignored 3 s offer expires and the radius grows to reach a driver 4.4 km away; a cancel during an offer frees the driver in about 260 ms; an unaccepted trip ends as `no_drivers`; 10 concurrent trips with 10 drivers are all matched in about 1.3 s with no driver used twice and offers from both instances; paused matchers leave the job in `mt:due`; with both matchers stopped the sweeper frees the held driver and a restarted matcher continues the job.

Fixed on the way: node-redis 6 answers `HGETALL` and `ZRANGE ... WITHSCORES` in RESP3 shapes; the job store reads both.

## Task 6: location-gateway

- [x] WebSocket on `/ws?user=&role=` attached to the Nest HTTP server; 1008 for a bad caller; ping every 20 s
- [x] `hello` and the active trip on connect
- [x] Ref-counted Redis subscriptions: driver inbox (offers) while the driver is connected, driver location while a rider's trip is live
- [x] Trip events from Kafka with one group per instance, pushed to the trip's rider and driver; events older than 60 s skipped
- [x] Two instances (7206, 7216); `GET /admin/stats`; `pnpm watch:ws` prints a socket's messages
- [x] Kit: Kafka session 10 s and rebalance 15 s for every consumer

Verified: a Node script with real sockets (rider on 7206, driver on 7216) passed 14 checks: the offer reaches the driver in about 300 ms after the request; the rider sees `matched` about 120 ms after accept; 5 locations arrive across instances in 16–18 ms each; a reconnect on the other instance gets the current trip in about 55 ms; statuses arrive in order; after completion no location reaches the rider and no channel stays subscribed. `http/gateway.http` passes, and all seven request files pass twice in a row (138 requests) after the kit change. A restarted consumer now reads again 1–2 s after `/health` answers (was 33–100 s).

Fixed on the way: `startFrom: "latest"` lost the first events on idle partitions; the gateway now starts at `earliest` and skips old events (ADR-026).

## Task 7: web app

- [x] Rider tab: pick pickup and dropoff on the map, estimate with surge and the price-hold countdown, request, live status and driver position, cancel
- [x] Driver tab: online at a map point, heartbeat, offers pushed over WebSocket with a countdown, accept and decline, arrive, start, complete, driver cancel, auto-drive
- [x] Lab tab: health of all 8 instances, counters, open matching jobs, switches per service, seed buttons, scenarios to try
- [x] Either tab can choose gateway 1 or 2; selections are per browser tab

Verified: a headless Chrome run over the DevTools protocol played a whole trip with two pages (rider on gateway 1, driver on gateway 2) and passed 19 checks: map clicks set pickup and dropoff, the estimate shows the fare, the offer appears on the driver page about 220 ms after the request, accept shows "Driver on the way" to the rider with the moving driver on the map, auto-drive reaches the pickup and the dropoff, each step shows on the rider page, the driver is available again, and the lab shows all 8 services up. Screenshots were checked by eye.

Fixed on the way: the driver saw each offer toast twice (StrictMode's second socket); offers are now announced once per trip.

## Task 8: simulator, load, failure drills, docs

- [x] `pnpm seed`, `pnpm simulate`, `pnpm load:riders`, `pnpm load:locations` (Node built-ins only, shared `scripts/lib.mjs`)
- [x] Failure drills in `docs/HOW-TO-RUN.md`; failure-mode table in `docs/architecture.md`
- [x] End-to-end sequence diagram, `docs/INTERVIEW-QUESTIONS.md`, README

Verified: `load:locations` with 200 drivers and 50 in flight: about 11,000 writes a second, p50 3.9 ms, p99 9.6 ms. `simulate --count 30` with `load:riders --count 20`: all 20 matched, the simulator completed trips on its own; a second batch of 10 in the same cell saw surge 3.0 (demand 26, supply 1). Kafka drill: with `ub-kafka` stopped a ride was still created and its event waited in the outbox; 3 s after Kafka started the outbox was empty, and the trip was offered 13 s after the restart.

## Task 9: easy to try

- [x] Demo riders and drivers created on the first visit when the databases are empty; `r001` and `d001` preselected
- [x] "How to take a ride" and "How to drive" checklists that mark done steps and explain the next one
- [x] Map legend for every mark; driver ids next to the dots when 20 or fewer are online
- [x] Rider: free drivers near the pickup before requesting; live matching progress after (who is asked, seconds left, declined, radius, wait)
- [x] Driver: "Online and waiting" card that says where requests come from
- [x] `GET /trips/:tripId/progress` on matching-service
- [x] The simulator finishes or cancels its trips when it stops, so no driver stays "on trip" forever

Verified: the headless Chrome run passed 21 checks, including the checklists and legend, `d001` listed as the first driver to be asked, and "Asking d001" on the rider page about 0.8 s after the request. `http/matching.http` passes twice (28 requests). The auto-seed path was not run against an empty database (the local one already had data); it calls the same idempotent seed endpoints as `pnpm seed`.

## Open items

- [~] httpYac itself is not in the local pnpm store, so the `.http` files were run with a small local runner of the same syntax, not with httpYac.
- [ ] Driver cancel ends the trip; re-matching it would be the next step (ADR-017).
- [ ] Surge does not smooth across neighbour cells (ADR-009).
