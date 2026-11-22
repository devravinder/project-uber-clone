# Interview questions

Design questions about ride-hailing, answered with what this project does. Each answer names the ADR in [DECISIONS.md](DECISIONS.md) with the trade-off.

## Location

1. Where do you store driver locations, and why not in the main database?
   - Redis GEO (`drv:geo`, `drv:geo:available`). Every online driver writes every few seconds and only the latest point matters, so a database row update per point would be write amplification for nothing (ADR-005). One driver-service process took about 11,000 writes a second here, p99 under 10 ms.
2. How do you find the nearest available drivers?
   - `GEOSEARCH drv:geo:available FROMLONLAT lng lat BYRADIUS r km ASC COUNT n`. The set holds only available drivers, so busy ones never fill the result (ADR-005).
3. How do you know a driver's app died?
   - A heartbeat key with a TTL, refreshed by every location update, and a sweeper that applies the expiry to the GEO sets every 2 s (ADR-006).
4. How does the rider see the driver move?
   - The location script `PUBLISH`es to `ub:loc:<driverId>`; the rider's gateway subscribes to that channel while the trip is live and pushes it over the WebSocket. Lag across two gateway instances was 16–18 ms (ADR-008, ADR-024).
5. Why not Kafka for locations?
   - A location is stale in seconds and replaced by the next one; Kafka would store and replay every point (ADR-008).

## Matching

1. How do you make sure two riders never get the same driver?
   - The matcher reserves the driver in driver-service before offering. The reserve is one Lua script that succeeds only from `available`, so exactly one trip can hold a driver; 20 parallel reserves gave one winner (ADR-007, ADR-020). trip-service adds a partial unique index on active trips per driver as the last guard (ADR-014).
2. How do you offer to one driver at a time with a timeout, and survive a crash?
   - Jobs and timers live in Redis: a hash per trip and a sorted set of due times polled by every matcher. Nothing is in process memory, so a restarted matcher continues (ADR-018).
3. Two matcher instances: how do they not step on each other?
   - A per-trip lock with a token, taken by the ticker, accept, decline and event handlers alike (ADR-019).
4. The offer timed out, but maybe the rider cancelled and the event was lost. What then?
   - Before acting on a timeout, ask trip-service for the trip's real state (ADR-021).
5. What if nobody accepts?
   - The radius grows 2, 4, 6 km; after 60 s the matcher ends the trip as `no_drivers`. If the matcher is down, trip-service's own reaper does it after 180 s (ADR-015).
6. A driver presses accept and the answer is lost. Is pressing again safe?
   - Yes. Both assigns repeat safely for the same trip, and on "no answer" the matcher keeps the offer instead of releasing the driver (ADR-022).

## Trips

1. How do you model the trip lifecycle?
   - A state machine table (`requested → matched → arrived → in_progress → completed`, plus `cancelled` and `no_drivers`) with actor rules, and optimistic locking on a version column (ADR-013).
2. The rider's app retries "request ride". How do you avoid two trips?
   - The quote id is unique on trips; the same quote returns the same trip with 200 (ADR-012). 10 parallel requests gave one trip.
3. How do other services learn about trip changes reliably?
   - A transactional outbox: the trip row and the event row commit together; a relay publishes to Kafka. With Kafka stopped, rides are still created and the events go out 3 s after Kafka returns.
4. A rider cancels exactly when the driver accepts. Who wins?
   - Whoever updates the version first. The loser re-reads and gets 409 (`INVALID_TRANSITION` or `TRIP_GONE`), and the driver is released. With a lab delay, a 10-way race showed 8 version conflicts and one write.

## Pricing

1. How does surge pricing work here?
   - Demand: trip requests in the pickup's geohash-5 cell over 5 minutes, counted from Kafka with per-minute counters. Supply: available drivers within 3 km. Surge grows with demand per driver, capped at 3.0 (ADR-009).
2. The price changes between the estimate and the request. What does the rider pay?
   - The quoted fare: quotes are stored for 2 minutes and trip-service charges the quote (ADR-010).
3. driver-service is down. Can riders still book?
   - Yes. Supply has an 800 ms budget; unknown supply means surge 1.0, not a failed quote (ADR-011).

## Real-time and scale

1. A rider and the driver are connected to different gateway servers. How do messages reach them?
   - Locations and offers through Redis pub/sub, trip state through Kafka with one consumer group per gateway, so every gateway sees every trip event (ADR-024).
2. A gateway restarts. What does the rider lose?
   - Nothing that matters: the socket reconnects, and on connect the gateway sends the active trip from trip-service. A reconnect on the other instance got the trip in about 55 ms.
3. A service restarts and takes a minute to consume again. Why, and how do you fix it?
   - The Kafka client's default session and rebalance timeouts (60 s and 102 s). Lowering them to 10 s and 15 s brought rejoin down to 1–2 s (ADR-027).
4. What would you change for a real city of a million drivers?
   - Shard driver locations by geohash prefix across Redis nodes (all keys of a script in one slot), route location writes over a persistent connection instead of HTTP, smooth surge across neighbour cells, re-match a trip when a driver cancels (ADR-017), and replace straight-line distance with a routing engine for ETAs (ADR-003).
