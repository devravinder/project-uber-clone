---
name: web-client
description: Structure and rules of apps/web (React + Vite + Tailwind, SVG city map, WebSocket to location-gateway). Use when changing anything in the web app.
---

# Web client

## Structure

| File                             | Role                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/api.ts`                     | Every REST call, through the Vite proxy `/api/<service>/...`                                    |
| `src/hooks.ts`                   | `usePoll`, `useTabState` (sessionStorage), `useGateway` (WebSocket), `useNow`                   |
| `src/components/city-map.tsx`    | SVG map of the demo city: drivers, surge cells, pickup, dropoff, a tracked point; click to pick |
| `src/components/rider-view.tsx`  | Pick on the map, estimate, request, live trip with the driver's position                        |
| `src/components/driver-view.tsx` | Online/offline, heartbeat, offers with countdown, trip steps, auto-drive                        |
| `src/components/lab-view.tsx`    | Health, counters, open matching jobs, switches, seed buttons, scenarios                         |
| `src/components/toast.tsx`       | Toasts and `useAction`, which shows an API error's `code`                                       |

## Rules

- Types come from `@apps/contracts`; never copy them. Geo helpers (`haversineKm`, `stepTowards`) too.
- The rider side calls rider-service only; the driver side calls driver-service, matching-service and trip-service.
- Proxy keys end in `/` (`/api/matching/`), otherwise `/api/matching` also matches `/api/matching-2`.
- WebSockets go straight to the gateways (`VITE_GATEWAY_WS`, `VITE_GATEWAY_2_WS`); each view can pick the gateway.
- Selections live in sessionStorage per tab (`ridelab.*`), so two tabs are a rider and a driver.
- Every click that calls an API goes through `useAction`, so failures show their `code`.
- Keep button texts and `data-testid`s stable; the browser check clicks by text.
- Port 5320, `strictPort`.

- Each view starts with a `Guide` checklist; when you add a step to a flow, add it there too.
- `app.tsx` seeds demo riders and drivers when the lists are empty; keep the seed endpoints idempotent.

## Learned

- React StrictMode opens a second socket briefly in development; announce each offer once (keyed by trip id).
- The driver view moves at 100 m per tick in auto-drive (fast-forward), and sends a heartbeat every 5 s when idle,
  because the heartbeat TTL is 30 s.
- A headless check drives local Chrome through the DevTools protocol with Node's global `WebSocket`; map clicks are
  `MouseEvent`s at coordinates computed from the SVG's bounding box.
