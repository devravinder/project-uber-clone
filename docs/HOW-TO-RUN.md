# How to run

Everything runs locally: containers for Postgres, Redis and Kafka, services on the host. Commands work in PowerShell (Windows) and bash (Ubuntu).

## Prerequisites

- Node 22 or newer and pnpm 12 (`corepack enable`)
- Docker with the images `postgres:latest`, `redis:6.2.24` and `bitnami/kafka:3.5.1`

## First start

```bash
pnpm install --offline
pnpm start:pods        # Postgres 5455, Redis 6401, Kafka 9205, creates the topics
pnpm start:services    # every service in one terminal; migrations run on start
```

Check that everything is up: run `http/health.http`, or open `http://localhost:7201/health` and the other ports below.

## Play a trip in the browser

1. Open `http://localhost:5320`, go to the Lab tab and press "Seed 20 riders" and "Seed 50 drivers".
2. Driver tab: choose `d001`, click the map where the driver is, press "Go online here".
3. Open a second browser tab. Rider tab: choose `r001`, click the pickup near the driver, then the dropoff, press "Get estimate", then "Request ride".
4. Back in the driver tab: the offer appears with a 10 s countdown. Accept it. With auto-drive on, the driver moves to the pickup; press "Arrived at pickup", "Start trip", then "Complete trip" at the dropoff.

The rider tab shows every step and the driver moving. Choose different gateways in the two tabs to see the cross-instance path.

## Ports

| App              | Port                      |
| ---------------- | ------------------------- |
| rider-service    | 7201                      |
| driver-service   | 7202                      |
| matching-service | 7203 (second: 7213)       |
| trip-service     | 7204                      |
| pricing-service  | 7205                      |
| location-gateway | 7206 (second: 7216)       |
| Postgres         | 5455 (user `ub`, pw `ub`) |
| Redis            | 6401                      |
| Kafka            | 9205 (host listener)      |

## One service at a time

```bash
pnpm start:driver      # also start:rider, start:matching, start:trip, start:pricing, start:gateway
pnpm start:matching:2  # second matching instance on 7213
pnpm start:gateway:2   # second gateway instance on 7216
```

## Two matchers

`pnpm start:services` also starts the second matching instance (7213) and the second gateway (7216). Lab switches are per instance: set them on both, or reset both at the start of a check.

## Scripts

| Command                                  | Does                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm seed`                              | Riders `r001..r020` and drivers `d001..d050` (idempotent)                         |
| `pnpm simulate --count 30`               | Drivers `s001..` that go online, wander, accept 90% of offers and drive the trips |
| `pnpm load:riders --count 20`            | 20 riders request at once near a hotspot; prints surge and time to match          |
| `pnpm load:locations --drivers 200`      | Location writes as fast as possible for 15 s; prints rate and latency             |
| `pnpm watch:ws --user <id> --role rider` | Prints what location-gateway pushes to that socket                                |

Options: `simulate --speed 0.15 --accept 0.9 --seconds 0` (0 runs until Ctrl+C), `load:riders --lat --lng --spread --wait --keep`, `load:locations --seconds --concurrency`.

Measured on a laptop: about 11,000 location writes a second into one driver-service (p99 under 10 ms); 20 simultaneous requests against 30 simulated drivers were all matched (p50 about 3 s, p95 about 55 s while drivers drove in); a second batch in the same cell saw surge 3.0.

## Failure drills

| Drill                         | How                                                             | Expect                                                            |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Kafka down                    | `docker stop ub-kafka`, request a ride, `docker start ub-kafka` | 201 for the ride; `GET :7204/admin/outbox` pending, then drained  |
| Redis down                    | `docker stop ub-redis`                                          | 503 `REDIS_UNAVAILABLE`; after start, drivers go online again     |
| driver-service down           | stop it, get an estimate                                        | 200 with `supply: null` and surge 1.0                             |
| Matchers down during an offer | stop 7203 and 7213 while an offer is open                       | the driver is freed by the sweeper; a restarted matcher continues |
| Gateway switch                | put rider and driver on different gateways in the web app       | locations and statuses still arrive                               |

## Watch a socket

```bash
pnpm watch:ws --user zr001 --role rider
pnpm watch:ws --user d001 --role driver --gateway ws://localhost:7216
```

It prints every message location-gateway pushes to that socket: `hello`, `trip`, `location`, `offer`, `offer-closed`.

## Request files

`http/*.http` are httpYac files, one per service. Run them with the httpYac CLI or the VS Code extension `anweber.vscode-httpyac`. Each file resets its switches first and can run twice in a row.

## Stop and reset

```bash
pnpm stop:pods         # keeps data
pnpm reset:pods        # deletes the volumes: databases and topics start empty
```

## Checks

```bash
pnpm typecheck
pnpm lint:md
pnpm exec oxlint
pnpm exec prettier --check .
```
