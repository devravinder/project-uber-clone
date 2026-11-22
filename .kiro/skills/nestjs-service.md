---
name: nestjs-service
description: Patterns for the NestJS services and libs/kit (NestJS 12 run by tsx, Prisma). Use when adding a service, controller, provider, consumer or background job.
---

# NestJS service patterns

## Start from the template

`apps/driver-service` shows the wiring: `package.json` scripts, `tsconfig.json`, `.env.sample`,
`prisma/`, `src/prisma.service.ts`, `src/main.ts`, `src/app.module.ts`. Copy it for a new service
(change name, port, database).

## Injection

`tsx` (esbuild) emits no decorator metadata. every constructor parameter needs `@Inject(Token)`,
classes included. Symptom when missing: `Cannot read properties of undefined` on first use.

## tsconfig include

tsx applies compiler options only to files in the tsconfig `include`. Each service includes
`../../libs/*/src`. Symptom when missing: "Parameter decorators only work when experimental
decorators are enabled".

## A service

- `src/main.ts` calls `bootstrap(AppModule)` from `@apps/kit`. Migrations run before start through
  the `dev` and `start` scripts (`prisma generate`, then `prisma migrate deploy`).
- `src/app.module.ts` imports `KitModule.forService(loadConfig(schema), { switches, choices })`.
  Extend `baseEnvSchema` with `.extend({...})` for service-specific variables.
- `KitModule` is global: `SERVICE_CONFIG`, `Redis`, `KafkaPublisher`, `KafkaConsumers` and `Switches`
  can be injected anywhere. `PrismaService` is the service's own provider.

## Errors and input

Throw with `fail(status, code, message, extra)`. Every error body has a stable `code`; the UI and
checks branch on it. `parse(schema, value)` turns a zod failure into 400 `INVALID_REQUEST`.
`@CurrentUser()` reads and validates `X-User`; `@OptionalUser()` allows anonymous callers.
`parseLimit(raw, 20, 100)` validates `limit`.

## Data access

Prisma only; see `prisma-orm`. Never call another service (HTTP) or Kafka inside a transaction.

## Kafka

- Produce through an outbox (`OutboxStore` + `OutboxRelay` from the kit), never inside the request.
- Consume with `KafkaConsumers.start({ groupId, topics, handler })` from `onApplicationBootstrap`.
  The handler must be idempotent; throw `PermanentError` for input that can never succeed.
- Same `groupId` on every instance splits the partitions (one handler run per event). Use a unique
  group id only when every instance must see every event.

## Background jobs

`setInterval` started in `onApplicationBootstrap`, one run at a time (`this.running ??= ...`), stopped
and awaited in `onModuleDestroy`. Two instances may run the same job: claim rows with
`FOR UPDATE SKIP LOCKED`.

## Redis

`Redis.connected()` connects on first use and waits at most 1 s. Commands go through `Redis.cmd([...])`;
several steps that must happen together go in one Lua script through `Redis.eval(script, keys, args)`.
Both turn a lost connection into 503 `REDIS_UNAVAILABLE`. Pub/sub uses `Redis.subscriber()`, a second
connection, because a subscribed connection can run no other command.

## Calling another service

`callJson(service, url, { method, body, user, timeoutMs })` from the kit. Every call has a timeout
(2 s default). It throws `UpstreamError` with the upstream `status` and `code`; `status` is null when nothing
answered. `isUnreachable(error)` is true for no answer or a 5xx.

## Known gotchas (from project-twitter-clone)

- Different status per branch (201 vs 200) needs `@Res({ passthrough: true })`.
- A throwaway script with top-level await run by `tsx` must be `.mts`.
- Windows: start a service with `Start-Process` and stop it by PID with `taskkill /PID <pid> /T /F`; going through `pnpm start` adds wrapper processes.
- A PowerShell function named `start` is shadowed by an alias; pick another name.
