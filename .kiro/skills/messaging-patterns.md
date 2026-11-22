---
name: messaging-patterns
description: Kafka and Redis pub/sub usage in this project - topics, keys, outbox, idempotent consumers, retries, DLT, channels. Use when producing or consuming events.
---

# Messaging patterns

## Kafka topic

| Topic            | Key     | Events                                                                                                            |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `ub.trip-events` | trip id | `TripRequested`, `TripMatched`, `DriverArrived`, `TripStarted`, `TripCompleted`, `TripCancelled`, `TripNoDrivers` |

Every event carries the whole trip (`TripEvent` in `@apps/contracts`). Validate with `tripEventSchema.safeParse`
and throw `PermanentError` for a bad one, which sends it to `ub.trip-events.dlt`.

## Producing: outbox

trip-service writes the trip row and an `outbox` row in one Prisma transaction. `OutboxRelay` (kit) claims due
rows with `FOR UPDATE SKIP LOCKED`, publishes with an idempotent producer and marks them sent. The outbox row id is
the `eventId`.

## Consuming

- At least once: duplicates happen. Make the effect idempotent (compare the trip id or version, `SET NX` on the
  event id) instead of trusting delivery.
- Order is per key, so one trip's events arrive in order. Two trips may interleave.
- Pass `isTransient` for outages (a dependency down): those retry and hold the partition instead of dead-lettering.

## Group ids

| Consumer         | Group id                  | Why                                             |
| ---------------- | ------------------------- | ----------------------------------------------- |
| driver-service   | `driver-service`          | Frees the driver when a trip ends               |
| matching-service | `matching-service`        | Instances share the work: one job per trip      |
| pricing-service  | `pricing-service`         | Counts demand per cell                          |
| location-gateway | `location-gateway-<port>` | Every instance must see every event (broadcast) |

## Redis pub/sub channels

| Channel                | Publisher                              | Subscriber       | Payload                             |
| ---------------------- | -------------------------------------- | ---------------- | ----------------------------------- |
| `ub:loc:<driverId>`    | driver-service (inside the Lua script) | location-gateway | `GatewayMessage` of type `location` |
| `ub:driver:<driverId>` | matching-service                       | location-gateway | `offer` and `offer-closed`          |

Pub/sub is fire and forget: a message with no subscriber is dropped. Use it only for data the next message
replaces (a location) or that has another source of truth (an offer is also in `GET /offers/current`).
