---
name: trip-state-machine
description: How trip-service changes trip state (rules table, actor checks, optimistic version, outbox, partial unique indexes, idempotent repeats). Use when adding a trip action or changing who may do what.
---

# Trip state machine

## Where

- `apps/trip-service/src/trips/state-machine.ts`: `RULES` (from, to, event) and `forbidden(action, trip, actor)`.
- `apps/trip-service/src/trips/trips.service.ts`: `transition()` and `create()`.

## Adding or changing a transition

1. Add or edit the rule in `RULES` and the actor check in `forbidden`.
2. Set the timestamp or fields in `apply()`.
3. Add the event type to `TRIP_EVENT_TYPES` in `@apps/contracts` if it is new, and handle it in each consumer.
4. Update the state diagram in `docs/architecture.md` and `http/trip.http`.

## Rules

- Never update a trip without `version` in the `WHERE`. A count of 0 means someone else won: re-read and decide again.
- The trip row and its outbox row change in one `$transaction`; never publish to Kafka directly.
- A repeated call that finds the target state is a 200 with no change. Only `assign` with a different driver is a 409.
- Errors: 404 `TRIP_NOT_FOUND`, 403 `NOT_YOUR_TRIP` / `INTERNAL_ONLY`, 409 `INVALID_TRANSITION` (with `status`),
  `TRIP_ALREADY_MATCHED`, `DRIVER_BUSY`, `ACTIVE_TRIP_EXISTS` (with `activeTripId`), `QUOTE_USED`, `VERSION_CONFLICT`.
- `/internal/trips/...` (assign, no-drivers) are for matching-service only.
- The partial unique indexes in the first migration are the last guard against double booking; keep the code check
  as well, for a friendly error.

## Lab switches

- `transitionDelayMs`: a pause between read and update, so a race shows version conflicts (`versionConflicts` in
  `GET /admin/stats`).
- `requestTimeoutSeconds`: the reaper ends unmatched trips after this long.
- `outboxPaused`: events wait in the outbox table, as if Kafka were down.
