# Архитектура проекта

Короткая карта проекта `mozhno`: Telegram-бот, VPN-выдача, подписки Xray/3X-UI, AmneziaWG-агенты, медиа-обработка и база данных.

## Состав

```text
Telegram
  -> bot
     -> PostgreSQL
     -> 3X-UI servers
     -> Amnezia agent servers
     -> media-worker

Public subscription URL
  -> xray-subscription
     -> PostgreSQL
     -> 3X-UI servers

Amnezia VPN server
  -> amneziya-agent
     -> local SQLite
     -> awg / awg0 / awg0.conf
```

## Карта серверов

```text
mb
  role: Telegram bot, PostgreSQL, media-worker
  services: bot, media-worker, postgres
  data: PostgreSQL, media files, backups

3xuiru
  role: RU Xray/3X-UI server, public subscription edge
  domains: xui.mozhno.org, xraydev.mozhno.org
  services: x-ui, xray, nginx, optional xui-sub-cleaner
  ports: 443 client traffic, 2096 3X-UI subscriptions, panel port private/admin

3xuide
  role: DE Xray/3X-UI server
  domain: srv2.xui.mozhno.org
  services: x-ui, xray
  ports: 443 VLESS+XHTTP+TLS, 2096 subscriptions

3xuilv
  role: LV Xray/3X-UI server
  domain: srv3.xui.mozhno.org
  services: x-ui, xray
  ports: 443 client traffic, 2096 subscriptions

amneziya1
  role: Stockholm AmneziaWG server
  domain: srv1.amneziya.mozhno.org
  services: amneziya-agent, Caddy, awg0
  vpn: 10.9.9.0/24, UDP 51820

amneziya2
  role: Dronten AmneziaWG server
  domain: srv2.amneziya.mozhno.org
  services: amneziya-agent, Caddy, awg0
  vpn: 10.9.10.0/24, UDP 51820

amneziya3
  role: Paris AmneziaWG server
  domain: srv3.amneziya.mozhno.org
  services: amneziya-agent, Caddy, awg0
  vpn: 10.9.11.0/24, UDP 51822
```

## Карта доменов

```text
mozhno.org
  xui.mozhno.org
    -> public Xray subscription endpoint
    -> currently may point to 3xuiru nginx / xui-sub-cleaner in old setup

  xraydev.mozhno.org
    -> dev/test Xray subscription endpoint
    -> expected target: xray-subscription service
    -> current checked state: Cloudflare -> 3xuiru nginx -> xui-sub-cleaner
    -> because of that it behaves like old xui-sub-cleaner and does not read dev DB

  srv2.xui.mozhno.org
    -> 3xuide Xray client traffic and subscriptions

  srv3.xui.mozhno.org
    -> 3xuilv Xray client traffic and subscriptions

  srv1.amneziya.mozhno.org
    -> amneziya1 agent API via Caddy

  srv2.amneziya.mozhno.org
    -> amneziya2 agent API via Caddy

  srv3.amneziya.mozhno.org
    -> amneziya3 agent API via Caddy
```

## Dev-контур сейчас

Текущее проверенное состояние:

```text
xraydev.mozhno.org
  -> Cloudflare
  -> 3xuiru nginx
  -> http://127.0.0.1:18080
  -> xui-sub-cleaner
  -> https://127.0.0.1:2096
  -> local 3X-UI subscription server on 3xuiru
```

То есть `xraydev.mozhno.org` сейчас не попадает в `xray-subscription` из репозитория и не читает dev PostgreSQL.

Актуальная dev-база для новой логики находится локально в Docker Compose проекта:

```text
local machine
  project: /Users/ilshat/project/cursor/mozhno
  compose project: mozhno
  service: postgres
  internal DSN for containers: postgres:5432/mozhno
  host port: 5432
  data dir: ./postgres/db_data
```

В этой dev-базе есть новая схема с `vpn_servers`, `vpn_keys.provider`, `server_id`, Amnezia/XUI-серверами и мультисерверной логикой.

На `mb` сейчас запущены `bot`, `media-worker`, `postgres`, но не `xray-subscription`. База на `mb` может отставать от dev-схемы, поэтому ее нельзя считать актуальной dev-базой без отдельной миграции/синхронизации.

Целевая dev-схема должна быть такой:

```text
xraydev.mozhno.org
  -> Cloudflare tunnel or reverse proxy
  -> xray-subscription:18081
  -> dev PostgreSQL
  -> 3X-UI servers by configured server list
```

## Потоки взаимодействия

### 1. Пользователь просит VPN в Telegram

```text
Telegram user
  -> Telegram Bot API
  -> bot on mb
  -> PostgreSQL on mb
  -> provider:
       XUI: 3X-UI API on selected 3xui server
       AMNEZIA: amneziya-agent API on selected AWG server
  -> PostgreSQL on mb: save key/server/limits/cache
  -> Telegram user: subscription/config/QR/instructions
```

### 2. Xray client обновляет мультиподписку

Целевая схема:

```text
Xray client
  -> https://xui.mozhno.org/sub/<subId>
  -> xray-subscription
  -> PostgreSQL on mb: validate subId, user, limits, active keys
  -> each 3X-UI server: fetch raw subscription by per-server subId
  -> xray-subscription: merge links, rewrite names, add headers
  -> Xray client
```

Старая схема через wrapper:

```text
Xray client
  -> https://xui.mozhno.org/sub/<subId>
  -> nginx on 3xuiru
  -> xui-sub-cleaner on 127.0.0.1:18080
  -> local 3X-UI sub server on 127.0.0.1:2096
  -> xui-sub-cleaner: rewrite names/headers/json
  -> Xray client
```

Отличие: старая схема не читает PostgreSQL и не знает про блокировки/лимиты пользователя из бота.

### 3. Xray client подключается к серверу

```text
Xray client
  -> srvN.xui.mozhno.org:443
  -> xray inbound on 3xui server
  -> client auth by UUID/password from 3X-UI
  -> internet

3X-UI
  -> tracks traffic and expiry per client
  -> disables expired/over-limit clients
```

### 4. Amnezia client подключается к AWG

```text
Amnezia client
  -> server public IP:UDP port
  -> awg0 on amneziyaN
  -> peer auth by public key + preshared key
  -> internet

amneziya-agent
  -> periodically reads awg show
  -> updates local SQLite traffic
  -> bot sync reads agent API and updates PostgreSQL
```

### 5. Amnezia peer lifecycle

```text
bot on mb
  -> amneziya-agent /peers
  -> agent:
       generate keys
       allocate IP from server CIDR
       update awg0.conf
       run awg syncconf
       store peer in local SQLite
  -> bot:
       store VpnKey in PostgreSQL
       cache config/QR/Telegram file ids
```

### 6. Медиа и аналитика клуба

```text
Telegram update
  -> bot middleware
  -> PostgreSQL:
       users
       club_events
       club_message_index
       club_media
       media_processing_jobs
  -> media-worker
  -> Telegram file download / transcription provider
  -> PostgreSQL update
  -> optional Telegram publication
```

## Docker-сервисы

Основной compose-файл: `docker-compose.yml`.

- `bot` - Telegram-бот на Telegraf. Обрабатывает команды, роли, VPN-выдачу, статистику и админские действия.
- `media-worker` - фоновая обработка медиа: загрузка, транскрибация, очистка текста, публикация.
- `xray-subscription` - HTTP-сервис мультиподписки `/sub/<subId>` для Xray/3X-UI.
- `amneziya` - локальный/dev запуск Amnezia agent из репозитория.
- `postgres` - основная PostgreSQL-база проекта.
- `cloudflared` - опциональный туннель для публикации `xray-subscription`.

Все команды проекта должны выполняться через Docker Compose.

## Бот

Код: `bot/src`.

Ключевые точки:

- `bot/src/index.ts` - запуск бота, подключение Prisma, старт фоновых синков.
- `bot/src/bot.ts` - регистрация команд и callback handlers.
- `bot/src/handlers/*` - обработчики Telegram-команд.
- `bot/src/services/vpn.service.ts` - бизнес-логика выдачи VPN.
- `bot/src/services/xui-client.ts` - клиент к 3X-UI API.
- `bot/src/services/amneziya-client.ts` - клиент к Amnezia agent API.
- `bot/src/services/amneziya-traffic-sync.service.ts` - синхронизация трафика Amnezia и отключение по лимитам.
- `bot/src/repositories/*` - доступ к данным через Prisma.

## База данных

Схема: `bot/prisma/schema.prisma`.

Основные сущности:

- `User` - Telegram-пользователь, роль, бан, VPN-блокировка, пользовательские лимиты.
- `VpnServer` - VPN-серверы разных провайдеров: `XUI` и `AMNEZIA`.
- `VpnKey` - выданный ключ/peer, сервер, provider, `subId`, срок, лимит, трафик, cached config/QR/file ids.
- `ClubEvent`, `ClubMessageIndex`, `ClubMedia`, `MediaProcessingJob` - аналитика клуба и медиа-пайплайн.
- `BotSetting` - простые runtime-настройки.

Изменения схемы делаются только миграциями Prisma внутри Docker. После миграции нужен `prisma generate` и рестарт сервисов, использующих Prisma.

## Xray / 3X-UI

3X-UI-серверы живут отдельно от бота. Бот создает/обновляет клиентов через 3X-UI API, а в своей базе хранит связь пользователя, сервера, `subId`, срока и лимитов.

Поток выдачи обычного XUI-ключа:

```text
/vpn -> bot
  -> PostgreSQL: найти/создать User, VpnServer, VpnKey
  -> 3X-UI API: создать клиента
  -> PostgreSQL: сохранить subId, срок, лимиты
  -> Telegram: отдать подписку/инструкцию
```

Поток мультиподписки:

```text
client -> xray-subscription /sub/<subId>
  -> PostgreSQL: найти активный VpnKey и пользователя
  -> PostgreSQL: найти все активные XUI-ключи пользователя
  -> 3X-UI servers: получить реальные ссылки по subId
  -> response: собрать одну подписку
```

В `ops/xui-sub-cleaner` лежит отдельный Python-wrapper для старой схемы. Он не ходит в PostgreSQL: только проксирует подписку из локального 3X-UI и переписывает заголовки/названия/JSON.

## AmneziaWG

Код агента: `amneziya/src`.

Amnezia agent ставится на каждый AWG-сервер и управляет локальным `awg0`.

Основные функции:

- HTTP API с bearer-auth.
- Создание/отключение peer.
- Выдача config и QR.
- Хранение peer-метаданных в локальной SQLite `agent.db`.
- Чтение runtime-трафика из `awg show`.
- Применение изменений через `awg syncconf`.
- Backup `awg0.conf` перед изменениями.

Поток выдачи Amnezia:

```text
/vpn -> Amnezia -> bot
  -> PostgreSQL: выбрать активный VpnServer
  -> Amnezia agent API: создать peer или получить существующий
  -> PostgreSQL: сохранить peer id, client id, config, QR, срок, лимит
  -> Telegram: отдать файл/QR/инструкцию
```

## Медиа-пайплайн

Бот индексирует события и сообщения клуба, а `media-worker` забирает задания из PostgreSQL.

```text
Telegram event
  -> bot event logger
  -> ClubMessageIndex / ClubMedia / MediaProcessingJob
  -> media-worker
  -> download/transcribe/cleanup/publish
  -> PostgreSQL update
```

## Внешняя инфраструктура

Типовые хосты:

- `mb` - сервер бота и PostgreSQL.
- `3xuiru`, `3xuide`, `3xuilv` - 3X-UI/Xray-серверы.
- `amneziya1`, `amneziya2`, `amneziya3` - AmneziaWG-серверы.
- `xui.mozhno.org` / `xraydev.mozhno.org` - публичные Xray subscription endpoints.
- `srvN.amneziya.mozhno.org` - API Amnezia agents.

DNS/сертификаты/прокси могут жить вне репозитория: Cloudflare, Caddy, nginx, systemd units и локальные конфиги серверов.

## Важные инварианты

- PostgreSQL - источник истины для пользователей, лимитов, VPN-ключей и серверов.
- 3X-UI - источник фактических Xray-клиентов и ссылок.
- Amnezia agent - единственная точка изменения `awg0.conf` на AWG-сервере.
- Один пользователь может иметь несколько ключей, но не больше одного ключа на один сервер.
- Общие пользовательские лимиты должны считаться по ключам пользователя, а не по одному серверу.
- Публичные API должны быть доступны только с авторизацией или через контролируемый backend-поток.

## Где смотреть детали

- `docs/3xui-install-inbounds-notes.md` - установка 3X-UI, inbounds, TLS/XHTTP.
- `docs/amneziya-install-agent-notes.md` - эксплуатация AmneziaWG и agent.
- `docs/amnezia-agent-wrapper-service-plan.md` - план и детали API agent.
- `ops/xui-sub-cleaner/README.md` - старый wrapper подписок.
