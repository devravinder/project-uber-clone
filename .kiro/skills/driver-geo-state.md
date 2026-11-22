---
name: driver-geo-state
description: How driver-service stores driver location and availability in Redis (GEO sets, state hash, heartbeat, Lua scripts) and which transitions are allowed. Use when changing driver state, nearby search or reservations.
---

# Driver location and state

## Keys (driver-service only)

| Key                 | Type       | Holds                                                     |
| ------------------- | ---------- | --------------------------------------------------------- |
| `drv:geo`           | GEO        | Every online driver; the map reads it                     |
| `drv:geo:available` | GEO        | Only drivers a matcher may offer to; `GEOSEARCH` reads it |
| `drv:state:<id>`    | hash       | `status`, `tripId`, `lat`, `lng`, `at`, `offerUntil`      |
| `drv:alive:<id>`    | string+TTL | Heartbeat, refreshed by every location update             |

## Statuses

`offline` → `available` (online) → `offered` (reserve) → `on_trip` (assign) → `available` (release).
`offered` → `available` on release (declined, expired, cancelled). Offline is allowed only from `available`.

## Rules

- Every change is one Lua script in `src/drivers/driver.scripts.ts`; never read the hash and write it back from
  TypeScript.
- `RESERVE` needs status `available` and a live heartbeat. `ASSIGN` and `RELEASE` need the same trip id that
  holds the driver, so a late or duplicate call for another trip does nothing.
- Repeating `ASSIGN` for the held trip answers success; repeating `RELEASE` answers `released: false`. Callers
  treat both as fine.
- The location script also `PUBLISH`es to `ub:loc:<id>`; there is no separate publish call.
- The sweeper (every 2 s, `ZSCAN` pages of 500) takes drivers with an expired heartbeat offline and frees offers
  past `offerUntil`. Drivers on a trip stay on it even when their heartbeat lapses.
- A script may touch keys it builds from `ARGV` (`LIST_ONLINE`). That is fine on a single Redis; Redis Cluster
  would need all keys passed in `KEYS` and a hash tag.

## Learned

- `GEOSEARCH` needs Redis 6.2 or newer (the compose file pins 6.2.24).
- `GEOSEARCH ... WITHCOORD WITHDIST` answers `[member, distance, [lng, lat]]`: longitude first.
- Redis restarts empty here (no persistence), so drivers must go online again; the 409 `DRIVER_OFFLINE` answer
  to a location update is the signal.
