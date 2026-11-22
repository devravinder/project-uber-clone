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
