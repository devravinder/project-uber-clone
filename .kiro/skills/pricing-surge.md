---
name: pricing-surge
description: How pricing-service computes fares and surge (geohash cells, per-minute demand counters, supply from driver-service, quote lock, fallback). Use when changing pricing, surge or quotes.
---

# Pricing and surge

## Rules

- Money is integer minor units (`fareMinor`); never floats in a stored price.
- A quote is saved in Redis (`prc:quote:<id>`) for `quoteTtlSeconds`; trip-service charges the quoted fare. Do not
  recompute the price later.
- Demand: `TripRequested` events counted per geohash-5 cell and minute (`prc:demand:<cell>:<minute>`), deduped by
  event id in the same Lua script. The window is the sum of the last N minute counters.
- Supply: available drivers within `supplyRadiusKm`, asked from driver-service with an 800 ms budget. Unknown supply
  means surge 1.0, never a failed quote.
- `forceSurge` above 0 overrides everything; use it for demos, and reset it after.

## Pattern: per-minute counters

One key per bucket (`<name>:<minute>`) with a TTL longer than the longest window. Reading a window is one `MGET` of
N keys. Nothing has to delete old buckets, and a late event lands in the minute it happened.

## Learned

- A request file that asserts exact fares must switch real surge off first: earlier requests in the same run raise
  demand in the cell (`http/pricing.http` does this).
- Geohash cells near a cell edge split a hotspot; the demo accepts that (ADR-009).
