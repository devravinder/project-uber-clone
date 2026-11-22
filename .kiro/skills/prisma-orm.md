---
name: prisma-orm
description: How the NestJS services use Prisma (schema per service, migrations, transactions, raw SQL escape hatches, outbox). Use when adding or changing a model, migration or database query.
---

# Prisma ORM

## Layout

- One Prisma schema per service: `apps/<service>/prisma/schema.prisma`, one database per service.
- Migrations are committed: `apps/<service>/prisma/migrations/`. Never edit an applied migration.
- Services never read another service's database. They use events or HTTP.
- `prisma.config.ts` per service holds the datasource URL from the environment (`DATABASE_URL`).
- Pin exact versions of `prisma` and `@prisma/client`; keep them identical across services.

## Setup that is verified (Prisma 7, Node 22+, run by tsx)

- `schema.prisma` has `generator client { provider = "prisma-client", output = "../src/generated/prisma" }`
  and a `datasource db { provider = "postgresql" }` with no `url`. The URL lives in `prisma.config.ts`
  (`datasource: { url: process.env.DATABASE_URL }`).
- The generated client is git-ignored. `pnpm typecheck` and `dev` run `prisma generate` first.
- The client needs a driver adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`
  from `@prisma/adapter-pg`. Import it from `./generated/prisma/client.js`.
- Each service has its own tiny `src/prisma.service.ts` (copy `apps/driver-service`), because the
  generated path is per service. The kit has no Prisma dependency.
- Prisma CLI does not read `.env` itself. Scripts call it as
  `node --env-file=.env.sample node_modules/prisma/build/index.js <command>`.
- Keep `CHECKPOINT_DISABLE=1` and `PRISMA_HIDE_UPDATE_MESSAGE=1` in `.env.sample`: no update check or
  telemetry call (see `local-only`).

## Commands

```bash
pnpm --filter @apps/<service> db:generate   # prisma generate
pnpm --filter @apps/<service> db:deploy     # apply committed migrations (also runs in dev and start)
```

## Creating a migration

The service role cannot create a shadow database, so `migrate dev` does not work. Generate SQL instead:

1. Edit `schema.prisma`.
2. Diff against the live database, or from empty for the first one:
   `... migrate diff --from-empty --to-schema prisma/schema.prisma --script` (later:
   `--from-config-datasource --to-schema ...`).
3. Save the SQL as `prisma/migrations/<yyyymmddhhmmss>_<name>/migration.sql`. Remove the
   "Loaded Prisma config" line, any `CREATE SCHEMA` statement and any banner text the CLI printed.
   Add `prisma/migrations/migration_lock.toml` containing `provider = "postgresql"` once.
4. `db:deploy`. A migration that failed leaves a failed row in `_prisma_migrations` (error `P3009`);
   in the local database, drop that table and the half-created tables, then deploy again.
5. Hand-written SQL in a migration is fine for things the schema cannot say (partial indexes,
   `CHECK` constraints).

## Models

- Ids are `BigInt` or `String` (ULID); never expose database sequence order as a ranking.
- Timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
- Index every column used in a feed or cursor query; declare it in the schema with `@@index`.
- Map names to snake_case with `@map` and `@@map`.
- Status fields are enums in the schema.

## Transactions

- `prisma.$transaction(async (tx) => { ... })`: use `tx` inside, never `prisma`, or the statement runs
  outside the transaction.
- Never call another service (HTTP) or publish to Kafka inside a transaction. Write an outbox row instead.
- Keep transactions short; no timers or waits inside.

## Raw SQL is allowed here

Use `$queryRaw` and `$executeRaw` (tagged templates, always parameterised) only for:

- Outbox claim: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING ...`.
- Hot-path counters, when `{ increment: n }` is not enough (for example upsert with a floor).
- Cursor queries the generated API cannot express.

Never use `$queryRawUnsafe` or build SQL from strings.

## Outbox

- The domain row and the `outbox` row are written in one `$transaction`.
- A relay claims due rows with a lease (`locked_until`), publishes with confirms, then marks them sent.
- Delivery is at least once. The outbox row id is the `eventId` that consumers dedupe on.

## Idempotent consumers

- Keep a `processed_events(event_id PRIMARY KEY)` table and insert it in the same `$transaction` as the
  effect. A unique-constraint error (`P2002`) means a duplicate: skip it.
- Prefer naturally idempotent writes (`upsert` by a stable key).

## Errors

- Map Prisma errors to the stable API codes with `fail(status, code, message)`:
  `P2002` unique violation to 409, `P2025` record not found to 404.
- The UI and tests branch on `code`, never on the message.

## Gotchas

- Fetch only the columns you need with `select`; a feed row must not load whole relations.
- Avoid `include` chains in hot paths; they become several queries.
- Pagination is by cursor (`createdAt`, `id`), not `skip`/`take` offsets.
- Seeds live in `prisma/seed.ts`, are idempotent (`upsert`), and run on demand only.
- Tests that need a database use a throwaway schema or database, never a developer's running one.

## Known gotchas (from project-twitter-clone)

- Prisma CLI scripts must read the env file: `node --env-file=.env.sample node_modules/prisma/build/index.js <command>`.
  Plain `prisma ...` sees no `DATABASE_URL` ("Connection url is empty") and prints an update banner.
  `generate` also takes `--no-hints`, otherwise a non-interactive run waits on a prompt.
- `DateTime` maps to `timestamp` without a zone. Use `@db.Timestamptz(3)`, or compare in raw SQL with
  `timezone('utc', now())`.
- `UPDATE ... RETURNING` does not keep the subquery order: sort claimed outbox rows by id before publishing.
- Partial indexes and `CHECK` constraints go by hand into `migration.sql` (Prisma cannot declare them).
- With the driver adapter a duplicate insert still reports `P2002`. Inside a transaction prefer
  `createMany({ skipDuplicates: true })` and check the count, since a raw unique violation aborts the transaction.
- A deleted-once rule is one conditional `UPDATE ... WHERE deleted_at IS NULL`: only the call that changes a row emits the event.
- Prettier has no parser for `.http` or `.prisma` files; its `--write` prints an error for them. Ignore it.
