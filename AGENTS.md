# Правила проекта «можнобот»

## Git и единая production-версия

- Эталон исходного кода — проверенная работающая версия на
  `mozhno_bot:/opt/mozhnobot` (`@MozhnoClub_Bot`).
- Основная локальная папка `/Users/ilshat/project/cursor/_project/mozhno`,
  ветка `main` на GitHub и серверный checkout `main` должны соответствовать
  одному коммиту и одному состоянию отслеживаемых файлов после завершения работы.
- До изменений проверять HEAD, ветку и Git status локально и на сервере.
  При расхождении сначала установить причину и сохранить обе версии;
  не считать локальную `main` автоматически актуальной.
- Разработку вести в отдельных ветках и рабочих копиях (git worktree).
  Основную локальную папку оставлять на подтверждённой production-версии.
- Перед изменениями создавать Git-точку возврата. Не смешивать чужую
  незавершённую работу со своими изменениями и не коммитить секреты,
  `.env`, выгрузки переписки, зависимости или воспроизводимые артефакты.
- После разрешённого выпуска синхронизировать GitHub `main`, сервер и
  основную локальную папку; проверить совпадение коммитов и tracked tree.
  Само наличие коммитов не означает завершённую синхронизацию.
- Серверные настройки, базы данных, секреты и локальные материалы не являются
  частью равенства tracked tree и не переносятся автоматически.
- Незавершённая ветка с Amnezia сохранена отдельно:
  `archive/local-amnezia-20260908`; её рабочая копия —
  `/Users/ilshat/project/cursor/_temp/mozhno-local-amnezia-20260908`.
  Не возвращать её изменения в production без отдельного запроса.

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

## Language Rule

Write all user-facing responses in Russian.

Conduct internal reasoning in Russian as well.
