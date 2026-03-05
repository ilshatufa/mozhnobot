# Agent Rules (teplo)

## Docker-Only Policy

All processes related to the platform must be started and executed **only inside Docker**.

- Do **not** run `npm`, `node`, `tsx`, `prisma`, `vite`, `jest`, `psql`, `redis-cli`, etc. directly on the host.
- Use `docker compose` (dev or prod compose file as appropriate) for:
  - starting services
  - running migrations
  - running scripts
  - installing dependencies (when needed)
  - running tests/lint/build

If a task would normally require a host command, translate it to the equivalent `docker compose exec/run ...` workflow.

## Database Changes Policy

All database changes must be done **only via migrations**.

- Create migrations **only via commands** (e.g. Prisma migrate tooling) running inside Docker.
- Never hand-write/edit migration SQL by yourself.
- Never apply schema changes by directly modifying the database (no manual `psql`, no ad-hoc updates).

## Prisma Post-Migration Rule

After applying any Prisma migration that changes the schema, always do both steps (inside Docker):

1. Run `prisma generate` to regenerate the Prisma Client.
2. Restart the affected Docker services (at minimum `backend`, and any other service that imports Prisma Client) so they pick up the new generated client.

## No Fallbacks Rule

Do not introduce fallback UI/data behavior by default (e.g. showing `—`, auto-substituting values, hiding rows/fields, or making assumptions when data is missing).

If a fallback is truly necessary for UX, **ask the user first** and get explicit confirmation of:

- where the fallback is applied
- what exact placeholder/value is shown
- which statuses/fields it affects
