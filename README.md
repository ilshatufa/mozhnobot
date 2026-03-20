# Club Bot — Клубный Telegram-бот с VPN

Telegram-бот для управления VPN-доступом участников клубной группы через панель 3X-UI.

## Требования

- Node.js 24
- PostgreSQL 17
- Панель 3X-UI с настроенным inbound

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Конфигурация

```bash
cp .env.example .env
```

Заполните `.env` — описание переменных в `.env.example`.

### 3. База данных

```bash
npx prisma migrate dev
```

### 4. Запуск в dev-режиме

```bash
npm run dev
```

## Docker

```bash
docker compose up -d
```

Сервис `migrate` автоматически применит миграции при первом запуске.

## Backup And Restore

Скрипты лежат в `scripts/` и используют `docker compose` для дампа и восстановления PostgreSQL.

### Создать backup-архив

```bash
./scripts/backup-create.sh
```

Архив попадёт в `./postgres/backups/`. Туда же отдельно сохранится raw dump `postgres-<timestamp>.dump`, а сама папка примонтирована в контейнер `postgres` как `/backups`.

Архив будет содержать:

- `docker-compose.yml`
- `.env`
- `bot/`
- `postgres/`
- `scripts/`
- дамп PostgreSQL `backup/postgres.dump`

### Передать архив на другой сервер

```bash
./scripts/backup-transfer.sh ./postgres/backups/mozhno-backup-<timestamp>.tar.gz user@host /opt/mozhnobot/mozhno-backup.tar.gz
```

### Развернуть архив на другом сервере

```bash
./scripts/backup-restore.sh /opt/mozhnobot/mozhno-backup.tar.gz /opt/mozhnobot
```

### Восстановить локальную БД из dump в `postgres/backups`

```bash
./scripts/backup-restore-mounted.sh postgres-<timestamp>.dump
```

Скрипт использует примонтированную папку `/backups` внутри контейнера `postgres`.

Скрипт:

- копирует файлы проекта в целевую папку
- поднимает `postgres`
- восстанавливает дамп БД через `pg_restore`
- запускает сервисы через `docker compose up -d --build`

### Один запуск: backup + transfer + remote restore

```bash
./scripts/backup-deploy-remote.sh user@host /opt/mozhnobot
```

## Команды бота

| Команда | Доступ | Описание |
|---------|--------|----------|
| `/start` | Все | Приветствие и список команд |
| `/vpn` | USER, ADMIN | Получить VPN-ключ (7 дней) |
| `/status` | USER, ADMIN | Статус VPN-ключа |
| `/block <id\|@user>` | ADMIN | Заблокировать VPN-доступ |
| `/unblock <id\|@user>` | ADMIN | Разблокировать VPN-доступ |
| `/ban <id\|@user>` | ADMIN | Полный бан в боте |
| `/unban <id\|@user>` | ADMIN | Разбанить |
| `/promote <id\|@user>` | ADMIN | Назначить администратором |
| `/users` | ADMIN | Список пользователей |

## Архитектура

```
src/
├── index.ts          — точка входа, graceful shutdown
├── bot.ts            — инициализация Telegraf, маршруты
├── config.ts         — валидация env через zod
├── logger.ts         — tslog
├── database.ts       — Prisma client
├── handlers/         — обработчики команд
├── middlewares/       — авторизация, проверка ролей
├── services/         — бизнес-логика (VPN, 3X-UI)
└── repositories/     — доступ к данным
```
