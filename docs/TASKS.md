# Tasks

One commit per task, made once its checks pass. `[x]` done and verified, `[~]` partly done (the line says what is missing), `[ ]` not started.

| #   | Task                                                                    | Status  |
| --- | ----------------------------------------------------------------------- | ------- |
| 1   | Scaffold: workspace, kit, contracts, infra, six services with `/health` | done    |
| 2   | driver-service: locations in Redis GEO, nearby search, reservations     | planned |
| 3   | pricing-service: quotes and surge per geohash cell                      | planned |
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
