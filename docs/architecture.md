# Architecture

## Services and data

```mermaid
flowchart LR
  web[web app] -->|REST| rider[rider-service]
  web -->|REST| driver[driver-service]
  web -->|accept, decline| matching[matching-service]
  web <-->|WebSocket| gateway[location-gateway]
  rider -->|quote| pricing[pricing-service]
  rider -->|create, cancel| trip[trip-service]
  trip -->|check quote| pricing
  matching -->|nearby, reserve, assign, release| driver
  matching -->|assign, no drivers| trip
  pricing -->|supply near pickup| driver
  trip -->|outbox| kafka[(ub.trip-events)]
  kafka --> matching
  kafka --> driver
  kafka --> pricing
  kafka --> gateway
  driver -->|"PUBLISH ub:loc:id"| redis[(Redis pub/sub)]
  matching -->|"PUBLISH ub:driver:id"| redis
  redis --> gateway
```

Each service owns its data: Postgres databases `riders`, `drivers` and `trips`, and Redis key prefixes `drv:`, `mt:` and `prc:`.

## driver-service

Driver profiles are in Postgres. Location and availability change every few seconds and live in Redis (ADR-005):

| Key                 | Holds                                                   |
| ------------------- | ------------------------------------------------------- |
| `drv:geo`           | Every online driver (GEO set), read by the map          |
| `drv:geo:available` | Drivers a matcher may offer to, read by `GEOSEARCH`     |
| `drv:state:<id>`    | Hash: status, trip id, position, last update, offer end |
| `drv:alive:<id>`    | Heartbeat with a TTL, refreshed by each location update |

```mermaid
stateDiagram-v2
  [*] --> offline
  offline --> available: online
  available --> offline: offline, or heartbeat expired
  available --> offered: reserve for a trip
  offered --> on_trip: assign (offer accepted)
  offered --> available: release (declined, expired, cancelled)
  on_trip --> available: release (trip ended)
```

Every arrow is one Lua script, so the status, the heartbeat and both GEO sets change together (ADR-007).

| Endpoint                                     | Caller            | Does                                            |
| -------------------------------------------- | ----------------- | ----------------------------------------------- |
| `PUT /drivers/:id/online`                    | driver            | Available at a position                         |
| `PUT /drivers/:id/location`                  | driver            | New position, heartbeat, publish to the gateway |
| `PUT /drivers/:id/offline`                   | driver            | 409 `DRIVER_BUSY` while offered or on a trip    |
| `GET /drivers/nearby?lat&lng&radiusKm&limit` | matching, pricing | Available drivers, nearest first                |
| `GET /drivers/online`                        | web map           | Every online driver with status                 |
| `POST /internal/drivers/:id/reserve`         | matching          | `available` → `offered` for one trip            |
| `POST /internal/drivers/:id/assign`          | matching          | `offered` → `on_trip` for that trip             |
| `POST /internal/drivers/:id/release`         | matching          | Back to `available` if held for that trip       |
| `GET /admin/stats`                           | lab               | Online, available, location writes per second   |

driver-service also consumes `ub.trip-events` (group `driver-service`): `TripCompleted`, `TripCancelled` and `TripNoDrivers` release the driver of that trip.

## pricing-service

```mermaid
sequenceDiagram
  participant R as rider-service
  participant P as pricing-service
  participant D as driver-service
  participant K as ub.trip-events
  R->>P: POST /quotes (pickup, dropoff)
  P->>P: distance, duration, cell = geohash5(pickup)
  P->>P: demand = sum of the last 5 minute counters of the cell
  P->>D: GET /drivers/nearby (800 ms budget)
  D-->>P: available drivers within 3 km
  P->>P: surge from demand and supply, fare
  P-->>R: quote, saved for 120 s
  K-->>P: TripRequested
  P->>P: count it once per event id in the pickup cell
```

| Key                          | Holds                                        |
| ---------------------------- | -------------------------------------------- |
| `prc:quote:<id>`             | Quote JSON, TTL 120 s (the price lock)       |
| `prc:demand:<cell>:<minute>` | Requests in that cell and minute, TTL 61 min |
| `prc:cells`                  | Sorted set: cell by last request time        |
| `prc:seen:<eventId>`         | Dedupe marker for consumed events, TTL 24 h  |

Fare in minor units: `max(8000, 5000 + 1200 x km + 200 x min) x surge`, rounded to whole currency units. Surge = `1 + (demand / supply - 1) x 0.5`, from 1.0 to 3.0; supply unknown means 1.0.

## trip-service

```mermaid
stateDiagram-v2
  [*] --> requested: POST /trips (quote)
  requested --> matched: assign (matching)
  requested --> no_drivers: no-drivers (matching or reaper)
  requested --> cancelled: cancel (rider)
  matched --> arrived: arrive (driver)
  matched --> cancelled: cancel (rider or driver)
  arrived --> in_progress: start (driver)
  arrived --> cancelled: cancel (rider or driver)
  in_progress --> completed: complete (driver)
  completed --> [*]
  cancelled --> [*]
  no_drivers --> [*]
```

Every arrow is `UPDATE ... WHERE id AND version` plus an outbox row in one transaction (ADR-013). The event names are `TripRequested`, `TripMatched`, `DriverArrived`, `TripStarted`, `TripCompleted`, `TripCancelled` and `TripNoDrivers`, keyed by trip id on `ub.trip-events`.

```mermaid
sequenceDiagram
  participant W as web app
  participant R as rider-service
  participant P as pricing-service
  participant T as trip-service
  participant K as ub.trip-events
  W->>R: POST /rides/estimate
  R->>P: POST /quotes
  P-->>R: quote (fare locked 120 s)
  R-->>W: quote
  W->>R: POST /rides (quoteId)
  R->>T: POST /trips (retried once if no answer)
  T->>P: GET /quotes/:id
  T->>T: one TX: trip row + outbox row
  T-->>R: 201 trip requested (200 if the quote was used before)
  R-->>W: trip
  T->>K: TripRequested (outbox relay)
```

| Index                         | Guards                                             |
| ----------------------------- | -------------------------------------------------- |
| `trips_quote_id_key`          | One trip per quote (idempotent request, ADR-012)   |
| `trips_one_active_per_rider`  | A rider has at most one requested or ongoing trip  |
| `trips_one_active_per_driver` | A driver is on at most one matched or ongoing trip |
| `outbox_pending_idx`          | The relay scans only unsent rows                   |

## matching-service

```mermaid
sequenceDiagram
  participant K as ub.trip-events
  participant M as matching-service
  participant D as driver-service
  participant G as location-gateway
  participant A as driver app
  participant T as trip-service
  K-->>M: TripRequested
  M->>M: job in mt:job, due now in mt:due
  M->>D: GET /drivers/nearby (2 km)
  M->>D: reserve nearest (offered, held 12 s)
  M->>G: PUBLISH ub:driver:id (offer, 10 s)
  G-->>A: offer
  alt driver accepts
    A->>M: POST /offers/:trip/accept
    M->>D: assign (on_trip)
    M->>T: assign driver (matched)
    T-->>K: TripMatched
  else declines or 10 s pass
    M->>T: GET /trips/:id (still requested?)
    M->>D: release
    M->>M: next driver, wider radius, or no-drivers after 60 s
  end
```

| Key                   | Holds                                                  |
| --------------------- | ------------------------------------------------------ |
| `mt:job:<tripId>`     | Pickup, dropoff, fare, radius, declined drivers, offer |
| `mt:due`              | Trip ids by the next time their job needs a step       |
| `mt:offer:<driverId>` | The trip a driver is offered, for the polling fallback |
| `mt:lock:<tripId>`    | Lock token so one instance handles a trip at a time    |

| Endpoint                          | Caller | Does                                        |
| --------------------------------- | ------ | ------------------------------------------- |
| `GET /offers/current`             | driver | The open offer for the caller, or null      |
| `POST /offers/:tripId/accept`     | driver | Matched; 409 if expired, gone or not theirs |
| `POST /offers/:tripId/decline`    | driver | Next driver right away                      |
| `GET /admin/jobs`, `/admin/stats` | lab    | Open jobs with due times; counters          |
