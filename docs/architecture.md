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
