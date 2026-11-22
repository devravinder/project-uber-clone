---
name: api-http-requests
description: Keep the httpYac request files in the root http/ folder up to date for every API change. Use whenever an endpoint is added, changed, or removed, or when testing APIs manually.
---

# API HTTP Requests (httpYac format)

## Rule

Every time an endpoint changes, update its `.http` file in the same task. No API change is done until its
requests and assertions reflect it.

## Layout

- Root `http/` folder, one file per service (`rider`, `driver`, `matching`, `trip`, `pricing`, `gateway`) plus
  `health.http` for every instance.
- Base URLs are variables at the top of each file (`@driver = http://localhost:7202`).
- Ids that must be unique per run come from a `{{ exports.x = ... }}` script block, so a file can run twice.
- Run with the httpYac CLI or the VS Code extension `anweber.vscode-httpyac` when installed. Do not use `pnpm dlx`,
  which needs the network.

## What each file covers

- The happy path of every endpoint, with assertions on status and key response fields.
- Every validation rule, each as its own request expecting 400 and its `code`.
- Idempotent calls repeated once (online twice, cancel twice, the same quote twice).
- Admin switches: start a file with `PUT /admin/switches/reset`, because a lab run can leave a switch changed.

## Conventions

- One request per `###` section; the title says what is expected, not just the URL.
- Assert the status first (`?? status == 200`), then the fields that matter, then `code` for errors.
- Chain requests with `# @name x` and `{{x.id}}`. Wait for the event pipeline with `# @sleep 2000`.

## Verify before committing

Run every file against the live services, twice: the second run proves the requests do not depend on fresh data.
