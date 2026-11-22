---
name: project-conventions
description: How this repo is organised, what every task must update, ports, and cross-platform rules. Use at the start of any task in this project.
---

# Project conventions

## Layout

- `apps/rider-service` - NestJS + Prisma: rider profiles, the rider-facing ride API (estimate, request, cancel).
- `apps/driver-service` - NestJS + Prisma + Redis: driver profiles, location in Redis GEO, availability and reservations.
- `apps/matching-service` - NestJS + Redis: matching jobs, offers with timeouts, accept and decline.
- `apps/trip-service` - NestJS + Prisma: trips, the state machine, outbox to Kafka.
- `apps/pricing-service` - NestJS + Redis: quotes, surge per geohash cell.
- `apps/location-gateway` - NestJS + `ws`: WebSocket push of locations, offers and trip updates.
- `apps/web` - React + Vite + Tailwind.
- `libs/kit` (`@apps/kit`) - config, Redis, Kafka publisher and consumers, outbox relay, switches, `/health`,
  HTTP client, ids, errors. `libs/contracts` (`@apps/contracts`) - events, REST shapes, geo helpers.
- `infra/` - Compose file and the Postgres init script. `docs/`, `http/` (one file per service), `scripts/`.

## Every task updates

1. `docs/TASKS.md` - mark `[x]`, or `[~]` with what is missing; note what was verified.
2. `docs/HOW-TO-RUN.md` - when commands, ports or env vars change.
3. `docs/DECISIONS.md` - an ADR for each choice with a rejected alternative, and for anything learned the hard way.
4. `http/<service>.http` - when an endpoint is added or changed.
5. `.kiro/skills` - when a new pattern or gotcha appears.

## Rules

- Pin exact dependency versions; use versions already in the local pnpm store (see `local-only`).
- Comments: one line, at most 15 words, the why (see `code-comments`).
- Windows (PowerShell) and Ubuntu (bash) both work: scripts are pnpm or Node.
- No organisation names, registry hosts or internal paths in tracked files (see `no-org-specific-info`).
- Commits: Conventional, lowercase subject, under 10 words, one commit at the end of each task. Never push.
- No auth: the caller names itself in the `X-User` header (rider id or driver id).
- Services never read another service's database or Redis keys. They use events (Kafka) or HTTP.
- Endpoints under `/internal/...` are for other services; the web app never calls them.

## Ports

rider 7201, driver 7202, matching 7203 (second 7213), trip 7204, pricing 7205, gateway 7206 (second 7216),
web 5320, Postgres 5455, Redis 6401, Kafka (host listener) 9205.

## Kafka topics

`ub.trip-events` (3 partitions, key = trip id) and `ub.trip-events.dlt`. Created by compose only; auto-create is off.

## Checking

No test framework. Each task is checked by running the services against the containers and recording what was
verified in `docs/TASKS.md`. The `.http` files are httpYac files; without httpYac in the local store they are run
with a small local runner.
