# Decisions (ADRs)

## ADR-001: Six NestJS services on the twitter-clone kit

- Context: the goal is to learn the ride-hailing concepts (geo search, matching, a trip state machine, live updates), not a new stack.
- Decision: NestJS 12 services run by tsx, Prisma 7 for Postgres, node-redis for Redis, `@platformatic/kafka` for Kafka, the same `libs/kit` as project-twitter-clone.
- Services: rider-service, driver-service, matching-service, trip-service, pricing-service, location-gateway.
- Rejected:
  - Four services (pricing in trip-service, the gateway in driver-service): fewer moving parts, but surge pricing and the WebSocket fan-out are each a concept worth its own boundary and failure mode.
  - A Java service: the Spring Boot learning already lives in learn-spring-boot.

## ADR-002: Data ownership

- Decision: each service owns its data. Postgres databases: `riders`, `drivers`, `trips`. Redis key prefixes: `drv:` (driver-service), `mt:` (matching-service), `prc:` (pricing-service). Services talk over HTTP or the `ub.trip-events` topic.
- Rejected: matching-service reading `drv:` keys directly. It would be faster, but the reservation rules would then live in two services.

## ADR-003: Straight-line distance, no maps

- Decision: distance is haversine, duration is distance at 24 km/h, the map is an SVG of a 22 km square demo city.
- Rejected: a routing engine or map tiles. They need network downloads and teach nothing about the system design.

## ADR-004: Redis connect timeout in the kit

- Context: node-redis retries a refused connection forever, so the first command after Redis went down waited without end.
- Decision: `Redis.connected()` waits at most 1 s; `Redis.cmd()` turns any connection error into 503 `REDIS_UNAVAILABLE`.
- Rejected: per-service wrappers (the twitter clone had one in feed-service only).

## ADR-005: Driver location in Redis GEO, two sets

- Context: every online driver sends a location every few seconds. 1,000 drivers every 2 s is 500 writes a second, and the only read that matters is "available drivers near this point".
- Decision: Redis GEO (a sorted set with geohash scores). `drv:geo` holds every online driver (for the map); `drv:geo:available` holds only drivers a matcher may offer a trip to. `GEOSEARCH ... BYRADIUS ... ASC COUNT n` answers the nearest-driver query.
- Rejected:
  - Postgres with PostGIS or a lat/lng index: durable, but each location is an update that writes WAL and leaves a dead row version for vacuum. Nobody needs last week's location of an available driver.
  - One GEO set filtered by status after the search: a busy area full of drivers on trips would fill `COUNT n` with drivers nobody can use.
- Consequences: losing Redis loses who is online. Drivers go online again on their next location update, which answers 409 `DRIVER_OFFLINE` (the simulator does this).

## ADR-006: Heartbeat key plus a sweeper

- Decision: every location update sets `drv:alive:<id>` with a TTL (`heartbeatTtlSeconds`, 30 by default). A sweeper walks `drv:geo` every 2 s with `ZSCAN` and takes drivers whose heartbeat expired offline. It also frees drivers whose offer outlived `offerUntil` (the matcher died).
- Rejected: expiring GEO members. Redis expires keys, not members of a sorted set, so a driver whose app died would stay "available" forever.
- Consequences: a dead driver can be found by a search for up to 2 s more. `RESERVE` checks the heartbeat key, so such a driver is never offered a trip.

## ADR-007: Driver state changes are Lua scripts

- Decision: online, location, offline, reserve, assign, release and sweep each run as one `EVAL` that checks the state hash, the heartbeat key and both GEO sets together. `RESERVE` succeeds only from `available`; `ASSIGN` and `RELEASE` only for the trip id that holds the driver.
- Rejected:
  - `WATCH`/`MULTI` optimistic transactions: they retry under contention, and the hottest key (a popular driver) is exactly where that hurts.
  - A Redis lock around read-then-write: two round trips and a lock to clean up when the caller dies.
- Verified: 20 parallel reservations of one driver give exactly one winner.

## ADR-008: Location over HTTP, fan-out over Redis pub/sub

- Decision: drivers send `PUT /drivers/:id/location`. The same Lua script publishes the point on `ub:loc:<driverId>`, which location-gateway forwards to the rider.
- Rejected: a Kafka topic for locations. Kafka keeps every record on disk and consumers would replay stale points; a location is useful for a few seconds and the next one replaces it.
- Consequences: a location published while no gateway is subscribed is lost, and that is fine.

## ADR-009: Surge per geohash cell, demand over supply

- Decision: demand is the number of `TripRequested` events in the pickup's geohash cell (precision 5, about 4.9 x 4.9 km) over the last `surgeWindowMinutes` (5). Supply is the number of available drivers within `supplyRadiusKm` (3) of the pickup, asked from driver-service. Surge = 1 + (demand / supply - 1) x 0.5, rounded to 0.1, from 1.0 up to `surgeMax` (3.0).
- Demand is kept in one counter per cell per minute (`prc:demand:<cell>:<minute>`), so the window is a sum of N counters and old minutes expire on their own.
- Rejected:
  - Hexagon grids (H3): better neighbours, but a library to vendor and nothing new to learn here.
  - Counting quotes as demand: a rider refreshing the estimate would raise their own price.
- Consequences: a cell edge splits a hotspot in two. Production systems smooth across neighbour cells; this project does not.

## ADR-010: Quotes are stored and locked for two minutes

- Decision: a quote is saved in Redis (`prc:quote:<id>`, TTL `quoteTtlSeconds`, 120). trip-service reads the quote by id and charges its fare, so the rider pays the price they saw even if surge moves before they confirm.
- Rejected: trip-service recomputing the fare at request time. The rider would see one price and pay another.
- Consequences: a quote id can be used for only one trip (`trips.quote_id` is unique), which also makes "request ride" idempotent (see trip-service in Task 4).

## ADR-011: Pricing degrades to no surge when supply is unknown

- Decision: the supply call has an 800 ms budget. On a timeout, error or 5xx the quote still answers 201 with `supply: null` and surge 1.0, and `supplyFallbacks` counts it.
- Rejected: failing the quote (riders cannot book while driver-service is down) or caching the last supply forever (stale prices after an outage).
- Verified: with driver-service stopped a quote answers 201 in 8 ms with surge 1.0.

## ADR-012: The quote id is the idempotency key for "request ride"

- Context: a rider's app retries when the answer is lost. Two trips from one tap would mean two drivers driving to one rider.
- Decision: `trips.quote_id` is unique. `POST /trips` with a quote that already has a trip returns that trip with 200 (201 only for a new trip). A quote used by another rider answers 409 `QUOTE_USED`.
- Rejected: an `Idempotency-Key` header and a keys table (as in the twitter clone). The quote is already a single-use token the client holds, so a second key adds nothing.
- Verified: 10 parallel requests with one quote create one trip (one 201, nine 200 with the same id).

## ADR-013: Trip state machine with optimistic locking

- Decision: the allowed transitions are a table (`RULES` in `state-machine.ts`) plus actor rules (`forbidden`). Each change is `UPDATE trips ... WHERE id = $1 AND version = $2` with `version + 1`, and the outbox row is written in the same transaction. A lost race re-reads the trip and decides again, at most 3 times.
- A repeated call that finds the trip already in the target state answers 200 with no change (complete twice, cancel twice, assign the same driver twice). A call from a state the rule does not allow answers 409 `INVALID_TRANSITION` with the current `status`.
- Rejected: `SELECT ... FOR UPDATE` for every change. It holds a row lock across the read and the decision, and the conflicts are rare (a rider cancelling while a driver accepts).
- Verified: with the lab switch `transitionDelayMs = 300`, a 10-way assign race gave one 200 and nine 409 `TRIP_ALREADY_MATCHED`; 8 of the 9 losers hit the version check and re-read; the trip was written once (version 1).

## ADR-014: Partial unique indexes guard one active trip per rider and per driver

- Decision: `trips_one_active_per_rider` on `rider_id` where the status is requested, matched, arrived or in_progress, and `trips_one_active_per_driver` on `driver_id` where it is matched, arrived or in_progress. The code checks first for a friendly error; the index is the guard that holds under any race.
- Rejected: only an application check. Two requests can both pass the check before either inserts.
- Consequences: a violation surfaces as Prisma `P2002`; trip-service maps it to 409 `ACTIVE_TRIP_EXISTS` (with `activeTripId`) or `DRIVER_BUSY`.

## ADR-015: trip-service ends trips nobody matched

- Decision: a reaper in trip-service turns trips still `requested` after `requestTimeoutSeconds` (180) into `no_drivers`, using the same versioned transition.
- Rejected: relying only on matching-service's own timeout. If matching-service is down or lost its job, riders would wait forever. The owner of the state owns its timeouts.

## ADR-016: rider-service is the rider-facing API

- Decision: the web app calls rider-service (`/rides/estimate`, `/rides`, `/rides/current`, `/rides/:id/cancel`), which checks the rider exists and calls pricing-service and trip-service with timeouts. 4xx answers pass through with their status, `code` and extra fields; no answer or a 5xx becomes 503 `PRICING_UNAVAILABLE` or `TRIPS_UNAVAILABLE`.
- "Request ride" is retried once when trip-service gave no answer at all. That is safe only because of ADR-012; nothing else is retried.
- Rejected: the web app calling trip-service directly. Every client would need to know the quote and trip rules.

## ADR-017: A driver cancel ends the trip

- Decision: a driver may cancel a matched or arrived trip; it becomes `cancelled` with `cancelledBy: driver`, and the rider requests again.
- Rejected: putting the trip back to `requested` for re-matching. Real apps do this, but it needs a "matched → requested" edge and a second matching job per trip; the learning value is in matching itself (Task 5).

## ADR-018: Matching jobs and timers live in Redis

- Context: matching is a series of timers (offer expires after 10 s, give up after 60 s, retry search after 2 s). Timers in process memory die with the process.
- Decision: one hash per open trip (`mt:job:<tripId>`) and one sorted set `mt:due` (trip id scored by the next time it needs attention). Every instance polls `ZRANGEBYSCORE mt:due -inf now` every 250 ms. Each step writes the next due time before it returns.
- Rejected:
  - `setTimeout` per offer: lost on restart, and a second instance would not know about it.
  - Holding the Kafka handler for the whole match: one slow trip would block its partition for a minute.
  - A Kafka delay topic: needs one topic per delay and still a poller.
- Verified: with both matchers stopped during an open offer, a restarted matcher continued the job from Redis and offered the next driver.

## ADR-019: One lock per trip, with a token

- Decision: every step on a job (tick, accept, decline, close by event) runs under `SET mt:lock:<tripId> <token> NX PX 5000` and releases with a Lua compare-and-delete. The ticker skips a locked trip; accept and decline wait up to 2 s, then answer 409 `TRIP_BUSY`.
- Rejected: a lock per instance (one big lock) or none, because accept and the ticker's expiry can hit the same trip in the same millisecond.
- Consequences: with two matcher instances, both poll the same `mt:due`, but a trip is handled by one at a time. Verified: 10 concurrent trips on 2 instances (7 + 3 offers), all matched, no driver used twice.

## ADR-020: Reserve the driver before offering

- Decision: the matcher calls driver-service `reserve` (available → offered, held for the offer time plus 2 s) before it publishes the offer. Only one trip can hold a driver, so two matchers can never offer the same driver at once, and the driver drops out of `GEOSEARCH` for other trips.
- Rejected: offering first and checking on accept. Two riders would see "driver found" and one would be told "sorry" seconds later.
- Consequences: a matcher that dies leaves a driver held; driver-service's sweeper frees holds past `offerUntil` (ADR-006). Verified: 43–66 ms after the hold ended.

## ADR-021: Check the source of truth before acting on a timeout

- Decision: when an offer expires, the matcher reads the trip from trip-service first. If the trip is no longer `requested` (cancelled, matched elsewhere, reaped) it drops the job instead of releasing and re-offering.
- Rejected: trusting only the events. A lost or late `TripCancelled` would otherwise send a new offer for a cancelled trip.

## ADR-022: Accept is idempotent and keeps the offer when a service does not answer

- Decision: accept runs driver-service `assign`, then trip-service `assign`. A 409 from trip-service (the rider cancelled meanwhile) releases the driver and answers 409 `TRIP_GONE`. No answer at all keeps the offer and answers 503; the driver can press accept again, because both assigns repeat safely for the same trip.
- Rejected: releasing the driver on any error. If trip-service had committed but the answer was lost, the trip would be matched to a driver the matcher just freed.

## ADR-023: Ignore stale `TripRequested` replays

- Decision: a `TripRequested` older than `matchTimeoutMs` creates no job. A new consumer group starts at the earliest offset, so without this a restart with a fresh group would try to match every trip ever requested.
- Rejected: starting matching's group at `latest`. A trip requested while the matcher was down would then never be matched.
