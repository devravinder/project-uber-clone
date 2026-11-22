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
