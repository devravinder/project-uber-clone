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
