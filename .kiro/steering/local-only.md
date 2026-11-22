# Local only: no pushing, no outside network calls

Everything in this project runs on the developer's machine against local containers.

- Never `git push`, never add or change a remote. Commits stay local and are reviewed there.
- No calls to anything outside the machine: no web search, no fetching docs, no telemetry, no update
  checks. Only `localhost` and the local Docker network.
- Install packages only from the local pnpm store: `pnpm install --offline`. If a package is missing
  from the store, stop and report it instead of downloading it.
- Never `docker pull`. Use the images already present (`postgres`, `redis:6.2.24`, `bitnami/kafka:3.5.1`).
- Prisma commands run with `CHECKPOINT_DISABLE=1` and `PRISMA_HIDE_UPDATE_MESSAGE=1` (set in each
  service's `.env.sample`), so the CLI makes no update or telemetry calls.
- Gradle runs with `--offline`.
