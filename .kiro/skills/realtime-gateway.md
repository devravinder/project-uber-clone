---
name: realtime-gateway
description: How location-gateway pushes locations, offers and trip updates over WebSocket across instances (sessions, ref-counted Redis subscriptions, Kafka broadcast groups). Use when changing what the gateway pushes or how clients connect.
---

# Realtime gateway

## Connect

`ws://localhost:7206/ws?user=<id>&role=rider|driver` (second instance 7216). The first message is `hello` with the
instance name, then the active trip if there is one. Message shapes are `GatewayMessage` in `@apps/contracts`.

## What flows where

| Message        | Source                                    | To                                     |
| -------------- | ----------------------------------------- | -------------------------------------- |
| `location`     | driver-service Lua `PUBLISH ub:loc:<id>`  | Riders whose live trip has that driver |
| `offer`        | matching-service `PUBLISH ub:driver:<id>` | That driver                            |
| `offer-closed` | matching-service, same channel            | That driver                            |
| `trip`         | `ub.trip-events` (group per instance)     | The trip's rider and driver            |

## Rules

- Keep the gateway stateless: sessions and subscriptions only, rebuilt from scratch on restart.
- Subscribe through `Channels` (ref-counted); never call `subscribe` directly, or a second socket would duplicate it.
- A rider watches the driver only while the trip is `matched`, `arrived` or `in_progress`.
- Forward pub/sub payloads as raw strings; they are already `GatewayMessage` JSON.
- The consumer skips events older than 60 s and never dead-letters: other services own the events.

## Checking

- `pnpm watch:ws --user <id> --role rider` prints what a socket receives.
- `GET /admin/stats` on each instance: riders, drivers, watches, channels, forwarded counts.
- Node 22+ has a global `WebSocket`, so scenario scripts need no package.

## Learned

- `startFrom: "latest"` lost the first events on idle partitions (ADR-026).
- The client's default Kafka timeouts made a restarted instance wait up to 100 s (ADR-027).
