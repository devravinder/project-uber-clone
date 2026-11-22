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

## Try it in the browser

No seed step is needed: on the first visit the web app creates riders `r001..r020` and drivers `d001..d050` if the databases are empty.

1. Open `http://localhost:5320` in two browser tabs.
2. Tab 1, "I am a driver": `d001` is selected. Click the map where the driver should be (the big blue dot moves there), then press "Go online here". Status shows `available` and a small green dot appears on every map.
3. Tab 2, "I am a rider": `r001` is selected. Click the map near the driver for the pickup (P), click again for the dropoff (D). The panel lists the free drivers your request will be offered to, nearest first.
4. Press "Get estimate", then "Request ride". The trip card shows who is being asked and how many seconds they have.
5. Tab 1 shows the offer with a 10 s countdown. Press "Accept". With auto-drive on, the driver drives to the pickup; press "Arrived at pickup", "Start trip", and at the dropoff "Complete trip".

Tab 2 shows every step and the driver moving. Each tab has a "How to..." checklist that marks what is done and says what to do next.

What the map shows:

| Mark            | Meaning                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| small green dot | an online driver who is free                                                                                                                 |
| small amber dot | a driver who has an offer and is deciding                                                                                                    |
| small blue dot  | a driver on a trip                                                                                                                           |
| big blue dot    | in the driver tab: you; in the rider tab: your driver                                                                                        |
| P / D           | pickup / dropoff                                                                                                                             |
| orange square   | a surge area: x(multiplier) (recent requests / free drivers), see [how the price is calculated](architecture.md#how-the-price-is-calculated) |

Want many drivers without opening tabs? Run `pnpm simulate`: 30 robot drivers go online, wander and accept 90% of offers. Stop it with Ctrl+C; it finishes or cancels its trips and goes offline.

Where a request goes: matching-service asks the nearest free driver within 2 km first. Each driver gets 10 s; on decline or timeout the next one is asked, and the circle grows to 4 and 6 km. After 60 s without a yes the trip ends as "No driver accepted".

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
