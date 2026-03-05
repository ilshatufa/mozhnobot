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
