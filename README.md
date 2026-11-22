# Uber clone

A learning project for ride-hailing system design: drivers stream their location, riders get a fare with surge pricing, a matcher offers the trip to the nearest driver one at a time, and the rider watches the driver move live.

## Services

| Service          | Port | Owns                                                         |
| ---------------- | ---- | ------------------------------------------------------------ |
| rider-service    | 7201 | Rider profiles and the rider-facing ride API                 |
| driver-service   | 7202 | Driver profiles, live location (Redis GEO), availability     |
| matching-service | 7203 | Matching jobs and offers with timeouts                       |
| trip-service     | 7204 | Trips and their state machine, trip events through an outbox |
| pricing-service  | 7205 | Quotes and surge per geohash cell                            |
| location-gateway | 7206 | WebSocket push of driver locations, offers and trip updates  |

## Docs

- [How to run](docs/HOW-TO-RUN.md)
- [Tasks](docs/TASKS.md)
- [Decisions](docs/DECISIONS.md)
