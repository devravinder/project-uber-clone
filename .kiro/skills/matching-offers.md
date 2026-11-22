---
name: matching-offers
description: How matching-service runs jobs, offers, timeouts, locks and accept/decline across instances. Use when changing matching, offer timing or the accept flow.
---

# Matching and offers

## Keys (matching-service only)

| Key                   | Holds                                                                |
| --------------------- | -------------------------------------------------------------------- |
| `mt:job:<tripId>`     | Hash: pickup, dropoff, fare, radius, declined drivers, current offer |
| `mt:due`              | Sorted set: trip id by the next time the job needs a step            |
| `mt:offer:<driverId>` | The trip a driver is currently offered (for `GET /offers/current`)   |
| `mt:lock:<tripId>`    | Lock token, 5 s                                                      |

## One step of a job

1. Take the trip lock; skip the trip if another instance has it.
2. Offer still open: reschedule at `offerUntil`.
3. Offer expired: ask trip-service; if the trip moved on, drop the job. Otherwise release the driver, add them to
   `declined`, publish `offer-closed`.
4. Older than `matchTimeoutMs`: `no-drivers` on trip-service, drop the job.
5. `GEOSEARCH` via driver-service within `radiusKm`, skip declined drivers, reserve the first free one, publish the
   offer on `ub:driver:<id>`, reschedule at `offerUntil`.
6. Nobody reserved: widen the radius by `radiusStepKm` up to `maxRadiusKm`, retry after `retryDelayMs`.

## Rules

- Every step writes its next due time; a job without one is never looked at again.
- Reserve before offering (ADR-020); never publish an offer for a driver you did not reserve.
- Accept and decline take the same trip lock as the ticker.
- Releasing a driver always passes the trip id; driver-service ignores a release for another trip.
- Events: `TripRequested` starts a job (ignored if older than `matchTimeoutMs`); `TripCancelled`, `TripNoDrivers`
  and `TripMatched` drop it. Never release the driver a `TripMatched` names.

## Lab switches

`offerTimeoutMs`, `matchTimeoutMs`, `startRadiusKm`, `radiusStepKm`, `maxRadiusKm`, `retryDelayMs`, `paused`
(the ticker stops; jobs wait in `mt:due`). Set them on both instances (7203 and 7213).

## Learned

- After a matcher restarts, its consumer group needs up to a minute to rejoin (two instances rebalance twice);
  a request file that sleeps 2 s for an offer fails in that window. Wait, then rerun.
- Test drivers must keep sending locations, or the 30 s heartbeat expires during a long check.
