# План сервиса-обертки над AmneziaWG

## Цель

Сделать отдельный сервис `amnezia-agent`, который предоставляет HTTP API для управления peer'ами AmneziaWG.

Сервис должен уметь:

- создавать peer;
- удалять peer;
- включать и отключать peer;
- получать список peer'ов;
- получать информацию по конкретному peer;
- возвращать клиентский config;
- возвращать QR-код;
- считать трафик по peer;
- отключать peer по сроку действия;
- отключать peer по лимиту трафика;
- вести журнал действий;
- сопоставлять peer с внешним строковым идентификатором `client`.

Этот сервис не является Telegram-ботом и не содержит бизнес-логику подписок. Он является технической оберткой над AmneziaWG.

## Основной принцип идентификации

Клиент внешней системы передает строку `client`, как в 3X-UI.

Пример:

```json
{
  "client": "tg_123456789_ivan"
}
```

Agent хранит связку:

```text
client -> public_key -> AmneziaWG peer
```

AmneziaWG технически знает peer по `PublicKey`, а внешние системы работают с понятной строкой `client`.

## Правила для `client`

`client`:

- обязательный;
- уникальный среди активных peer'ов;
- длина до 128 символов;
- может содержать только безопасные символы:
  - `a-z`
  - `A-Z`
  - `0-9`
  - `_`
  - `-`
  - `.`
  - `@`
  - `:`

Для Telegram-бота рекомендуемый формат:

```text
tg_<telegram_id>_<username>
```

Если username отсутствует:

```text
tg_<telegram_id>
```

## Архитектура

```text
External client / Telegram bot / admin tool
  |
  | HTTPS + Bearer token
  v
amnezia-agent
  |
  | local operations
  v
awg / awg0 / /etc/amnezia/amneziawg/awg0.conf
```

Agent должен быть единственной точкой изменения `awg0.conf`.

## Docker-only требование

Agent должен разрабатываться и запускаться в Docker.

Все процессы, связанные с agent, должны выполняться только через Docker/Compose:

- установка зависимостей;
- запуск dev-сервера;
- запуск тестов;
- сборка;
- миграции/инициализация SQLite;
- production-запуск;
- health-check;
- диагностика приложения.

Не запускать на host напрямую:

- `npm`;
- `node`;
- `tsx`;
- test runner;
- migration scripts;
- любые служебные скрипты agent.

Для локальной разработки использовать команды вида:

```bash
docker compose run --rm amnezia-agent npm install
docker compose run --rm amnezia-agent npm test
docker compose up amnezia-agent
```

Для production на сервере AmneziaWG agent также должен запускаться контейнером. Контейнеру нужны только минимально необходимые mount'ы и capabilities для управления AmneziaWG.

Рекомендуемые mount'ы:

```text
/etc/amnezia/amneziawg:/etc/amnezia/amneziawg
/var/lib/amnezia-agent:/var/lib/amnezia-agent
/var/backups/amnezia-agent:/var/backups/amnezia-agent
```

Если agent вызывает `awg` внутри контейнера, нужно явно решить один из вариантов:

1. установить `amneziawg-tools` внутри image;
2. пробросить нужный бинарь read-only;
3. вынести операции применения config в минимальный host-side helper.

Предпочтительный вариант для MVP: image содержит нужные userspace tools, а контейнер получает только те права и mount'ы, которые нужны для `awg show`, изменения config и применения peer.

## Авторизация

Все запросы должны требовать заголовок:

```http
Authorization: Bearer <AMNEZIA_AGENT_TOKEN>
```

Без корректного токена API возвращает `401 Unauthorized`.

## API

### `GET /health`

Проверка состояния сервиса.

Ответ:

```json
{
  "ok": true,
  "interface": "awg0",
  "awgActive": true
}
```

### `GET /peers`

Возвращает список peer'ов.

Query-параметры:

```text
includeDeleted=false
```

Ответ:

```json
[
  {
    "peerId": "client_public_key",
    "client": "tg_123456789_ivan",
    "assignedIp": "10.9.9.4/32",
    "enabled": true,
    "deleted": false,
    "latestHandshakeAt": "2026-07-02T04:20:00.000Z",
    "endpoint": "178.178.215.156:33080",
    "rxBytes": 123456,
    "txBytes": 987654,
    "totalRxBytes": 123456,
    "totalTxBytes": 987654,
    "trafficLimitBytes": 53687091200,
    "trafficUsedBytes": 1111110,
    "display": {
      "rx": "123 KB",
      "tx": "988 KB",
      "trafficUsed": "1.11 MB",
      "trafficLimit": "53.7 GB"
    },
    "expiresAt": "2026-08-02T00:00:00.000Z",
    "disabledReason": null,
    "createdAt": "2026-07-02T10:00:00.000Z",
    "updatedAt": "2026-07-02T10:00:00.000Z"
  }
]
```

### `POST /peers`

Создает peer.

Запрос:

```json
{
  "client": "tg_123456789_ivan",
  "expiresAt": "2026-08-02T00:00:00.000Z",
  "trafficLimitBytes": 53687091200
}
```

`expiresAt` и `trafficLimitBytes` опциональны. Agent должен поддерживать работу без лимитов.

Режимы:

- `expiresAt` не передан или `null` - peer не отключается по сроку.
- `trafficLimitBytes` не передан или `null` - peer не отключается по трафику.
- оба значения не переданы или `null` - peer работает бессрочно и без лимита трафика.

Если лимиты переданы, agent обязан сам отключить peer при наступлении условия:

- `expiresAt` в прошлом;
- `totalRxBytes + totalTxBytes >= trafficLimitBytes`.

Если оба ограничения переданы, отключение происходит по первому наступившему условию.

Ответ:

```json
{
  "peerId": "client_public_key",
  "client": "tg_123456789_ivan",
  "assignedIp": "10.9.9.4/32",
  "enabled": true,
  "expiresAt": "2026-08-02T00:00:00.000Z",
  "trafficLimitBytes": 53687091200,
  "alreadyExists": false,
  "config": "[Interface]\n..."
}
```

Если активный peer с таким `client` уже существует, endpoint должен быть идемпотентным и вернуть существующий peer:

```json
{
  "peerId": "client_public_key",
  "client": "tg_123456789_ivan",
  "assignedIp": "10.9.9.4/32",
  "enabled": true,
  "expiresAt": "2026-08-02T00:00:00.000Z",
  "trafficLimitBytes": 53687091200,
  "alreadyExists": true,
  "config": "[Interface]\n..."
}
```

Если существующий peer найден по `client`, но в запросе переданы новые `expiresAt` или `trafficLimitBytes`, agent должен обновить лимиты существующего peer и записать это в журнал действий.

Чтобы убрать лимит, нужно передать `null`:

```json
{
  "expiresAt": null,
  "trafficLimitBytes": null
}
```

### `GET /peers/:peerId`

Возвращает peer по public key.

Ответ:

```json
{
  "peerId": "client_public_key",
  "client": "tg_123456789_ivan",
  "assignedIp": "10.9.9.4/32",
  "enabled": true,
  "latestHandshakeAt": "2026-07-02T04:20:00.000Z",
  "endpoint": "178.178.215.156:33080",
  "rxBytes": 123456,
  "txBytes": 987654,
  "totalRxBytes": 123456,
  "totalTxBytes": 987654,
  "trafficLimitBytes": 53687091200,
  "trafficUsedBytes": 1111110,
  "display": {
    "rx": "123 KB",
    "tx": "988 KB",
    "trafficUsed": "1.11 MB",
    "trafficLimit": "53.7 GB"
  },
  "expiresAt": "2026-08-02T00:00:00.000Z",
  "disabledReason": null
}
```

### `GET /peers/by-client/:client`

Возвращает peer по внешнему идентификатору `client`.

Это основной endpoint для Telegram-бота и других внешних систем.

### `GET /peers/:peerId/config`

Возвращает клиентский config.

Ответ:

```json
{
  "peerId": "client_public_key",
  "client": "tg_123456789_ivan",
  "config": "[Interface]\n..."
}
```

### `GET /peers/by-client/:client/config`

Возвращает клиентский config по `client`.

### `GET /peers/:peerId/qr`

Возвращает QR-код для client config.

Варианты ответа:

- `image/png`;
- или JSON с base64.

Для MVP проще JSON:

```json
{
  "peerId": "client_public_key",
  "client": "tg_123456789_ivan",
  "qrPngBase64": "..."
}
```

### `GET /peers/by-client/:client/qr`

Возвращает QR-код по `client`.

### `POST /peers/:peerId/disable`

Отключает peer без удаления записи.

Запрос:

```json
{
  "reason": "manual"
}
```

Ответ:

```json
{
  "ok": true
}
```

### `POST /peers/by-client/:client/disable`

Отключает peer по `client`.

### `POST /peers/:peerId/enable`

Включает ранее отключенный peer.

Если peer был отключен по истечению срока или лимиту трафика, включение допустимо только после обновления соответствующего лимита или снятия ограничения через `null`.

Ответ:

```json
{
  "ok": true
}
```

### `POST /peers/by-client/:client/enable`

Включает peer по `client`.

### `DELETE /peers/:peerId`

Удаляет peer из активного server config и помечает запись удаленной.

Ответ:

```json
{
  "ok": true
}
```

### `DELETE /peers/by-client/:client`

Удаляет peer по `client`.

### `PATCH /peers/:peerId/limits`

Обновляет срок действия и лимит трафика.

Запрос:

```json
{
  "expiresAt": "2026-09-02T00:00:00.000Z",
  "trafficLimitBytes": 107374182400
}
```

Чтобы отключить ограничения, передаются `null`:

```json
{
  "expiresAt": null,
  "trafficLimitBytes": null
}
```

Ответ:

```json
{
  "ok": true
}
```

### `PATCH /peers/by-client/:client/limits`

Обновляет срок действия и лимит трафика по `client`.

### `GET /actions`

Возвращает журнал действий.

Query-параметры:

```text
client=
peerId=
action=
limit=100
```

Ответ:

```json
[
  {
    "id": 123,
    "action": "peer_auto_disabled",
    "client": "tg_123456789_ivan",
    "peerId": "client_public_key",
    "reason": "traffic_limit",
    "createdAt": "2026-07-10T10:00:00.000Z",
    "payload": {
      "trafficUsedBytes": 53687091200,
      "trafficLimitBytes": 53687091200
    }
  }
]
```

### `GET /peers/:peerId/actions`

Возвращает журнал действий по peer.

### `GET /peers/by-client/:client/actions`

Возвращает журнал действий по `client`.

## Модель данных agent

Agent должен хранить состояние в SQLite.

### `peers`

```text
id
client
public_key
private_key_encrypted
preshared_key_encrypted
assigned_ip
config_text_encrypted
enabled
traffic_limit_bytes
created_at
updated_at
expires_at
disabled_at
disabled_reason
deleted_at
```

`expires_at` и `traffic_limit_bytes` nullable. `null` означает, что соответствующее ограничение не применяется.

Ограничения:

```text
unique(public_key)
unique(assigned_ip) where deleted_at is null
unique(client) where deleted_at is null
```

### `peer_traffic`

```text
peer_id
total_rx_bytes
total_tx_bytes
last_rx_bytes
last_tx_bytes
last_sampled_at
updated_at
```

### `peer_lifecycle`

Опциональная агрегированная таблица для быстрых проверок истечений.

```text
peer_id
expires_at
traffic_limit_bytes
traffic_used_bytes
is_expired_by_time
is_expired_by_traffic
last_checked_at
```

### `traffic_snapshots`

```text
id
peer_id
rx_bytes
tx_bytes
sampled_at
```

Snapshots нужны для диагностики и пересчета. Для MVP можно хранить ограниченное окно, например 7-30 дней.

### `action_log`

```text
id
action
client
peer_id
reason
payload_json
actor_type
actor_id
created_at
```

В action log нельзя писать private key, preshared key и полный client config.

Рекомендуемые значения `action`:

```text
peer_created
peer_returned_existing
peer_limits_updated
peer_disabled
peer_enabled
peer_deleted
peer_auto_disabled
traffic_sampled
config_returned
qr_returned
```

Рекомендуемые значения `reason`:

```text
manual
expired_at
traffic_limit
deleted
api_request
```

## Учет трафика

API всегда хранит и возвращает точные значения в байтах. Для отображения людям рядом возвращаются десятичные поля `*Formatted` в единицах `KB`, `MB`, `GB`, `TB`, где:

```text
1 KB = 1000 bytes
1 MB = 1000 KB
1 GB = 1000 MB
```

Двоичные единицы `KiB`, `MiB`, `GiB` в пользовательских ответах не использовать.

Источник данных:

```bash
awg show awg0 dump
```

Для каждого peer доступны:

```text
public_key
endpoint
allowed_ips
latest_handshake
rx_bytes
tx_bytes
```

Agent должен сопоставлять `public_key` с записью `peers`.

Алгоритм:

1. Периодически читать `awg show awg0 dump`.
2. Для каждого peer брать `rx_bytes` и `tx_bytes`.
3. Сравнивать с `last_rx_bytes` и `last_tx_bytes`.
4. Если текущие значения больше или равны последним, добавлять разницу.
5. Если текущие значения меньше последних, считать, что runtime-счетчик сбросился, и добавлять текущие значения как новую дельту.
6. Обновлять `peer_traffic`.
7. При необходимости писать `traffic_snapshots`.
8. Проверять `trafficLimitBytes`.
9. Если лимит достигнут, автоматически отключить peer с `disabled_reason=traffic_limit`.
10. Записать действие `peer_auto_disabled` в `action_log`.

Пример обычного случая:

```text
last_tx = 1000
current_tx = 1500
delta = 500
```

Пример после reboot/interface restart:

```text
last_tx = 1500
current_tx = 200
delta = 200
```

## Отключение по сроку и лимиту

Agent должен сам применять ограничения, если они заданы.

### По сроку

Условие:

```text
expires_at is not null and expires_at <= now()
```

Действие:

1. Взять lock.
2. Проверить, что peer еще enabled и не deleted.
3. Убрать peer из active server config.
4. Применить изменения.
5. Установить:
   - `enabled=false`;
   - `disabled_at=now()`;
   - `disabled_reason=expired_at`.
6. Записать `peer_auto_disabled` в `action_log`.

### По трафику

Условие:

```text
traffic_limit_bytes is not null and total_rx_bytes + total_tx_bytes >= traffic_limit_bytes
```

Действие:

1. Взять lock.
2. Проверить, что peer еще enabled и не deleted.
3. Убрать peer из active server config.
4. Применить изменения.
5. Установить:
   - `enabled=false`;
   - `disabled_at=now()`;
   - `disabled_reason=traffic_limit`.
6. Записать `peer_auto_disabled` в `action_log`.

### Scheduler

Agent должен иметь внутренний scheduler:

- traffic polling: по `AMNEZIA_TRAFFIC_POLL_INTERVAL_MS`;
- expiration polling: по `AMNEZIA_EXPIRATION_POLL_INTERVAL_MS`.

Проверка срока должна работать даже если по peer нет трафика.

## Работа с AmneziaWG config

### Создание peer

1. Взять lock.
2. Проверить, нет ли активного peer с таким `client`.
3. Прочитать текущие peer из SQLite и server config.
4. Найти свободный IP в `AMNEZIA_CLIENT_CIDR`.
5. Сгенерировать:
   - client private key;
   - client public key;
   - preshared key.
6. Собрать client config.
7. Сделать backup server config.
8. Добавить `[Peer]` в server config.
9. Применить изменения через `awg syncconf` или согласованный безопасный механизм.
10. Сохранить запись в SQLite.
11. Сохранить `expires_at` и `traffic_limit_bytes`, если они переданы.
12. Записать `peer_created` в `action_log`.
13. Вернуть ответ.

### Комментарии в server config

Для удобства можно добавлять комментарий:

```ini
# client=tg_123456789_ivan createdAt=2026-07-02T00:00:00.000Z
[Peer]
PublicKey = ...
PresharedKey = ...
AllowedIPs = 10.9.9.4/32
```

Но комментарий не должен быть основным источником истины. Основной источник истины - SQLite agent.

### Disable peer

1. Взять lock.
2. Сделать backup server config.
3. Убрать peer из активного config.
4. Применить изменения.
5. Обновить `enabled=false`, `disabled_at`, `disabled_reason`.
6. Записать `peer_disabled` в `action_log`.

### Enable peer

1. Взять lock.
2. Проверить, что peer не deleted.
3. Сделать backup server config.
4. Вернуть peer в active config.
5. Применить изменения.
6. Обновить `enabled=true`, `disabled_at=null`.
7. Сбросить `disabled_reason`.
8. Записать `peer_enabled` в `action_log`.

### Delete peer

1. Взять lock.
2. Сделать backup server config.
3. Убрать peer из active config.
4. Применить изменения.
5. Обновить `deleted_at`.
6. Записать `peer_deleted` в `action_log`.

## Конфигурация agent

```env
AMNEZIA_AGENT_TOKEN=long-random-token
AMNEZIA_AGENT_HOST=127.0.0.1
AMNEZIA_AGENT_PORT=8080

AMNEZIA_INTERFACE=awg0
AMNEZIA_SERVER_HOST=138.124.96.168
AMNEZIA_SERVER_PORT=51820
AMNEZIA_CLIENT_CIDR=10.9.9.0/24
AMNEZIA_DNS=1.1.1.1
AMNEZIA_CONFIG_PATH=/etc/amnezia/amneziawg/awg0.conf
AMNEZIA_AGENT_DB_PATH=/var/lib/amnezia-agent/agent.db
AMNEZIA_BACKUP_DIR=/var/backups/amnezia-agent
AMNEZIA_TRAFFIC_POLL_INTERVAL_MS=60000
AMNEZIA_EXPIRATION_POLL_INTERVAL_MS=60000
AMNEZIA_ACTION_LOG_RETENTION_DAYS=180
AMNEZIA_TRAFFIC_SNAPSHOT_RETENTION_DAYS=30
```

## Безопасность

Минимальные требования:

- HTTPS, если API доступен не только локально.
- Bearer token.
- Firewall allowlist.
- Rate limit.
- Lock на write-операции.
- Backup config перед каждым изменением.
- Private key, preshared key и config не писать в логи.
- Action log всех write-операций и автоматических отключений.
- Отдельный systemd service.
- Отдельный пользователь `amnezia-agent`, если возможно.

## Рекомендуемый стек

- Node.js/TypeScript.
- Fastify.
- Zod.
- SQLite.
- `qrcode` для QR.
- Docker/Compose.
- systemd только как wrapper для `docker compose up -d`, если нужен автозапуск на сервере.

## Этапы реализации

### Этап 1. Спецификация и каркас

- Создать проект agent.
- Добавить `Dockerfile`.
- Добавить compose-сервис `amnezia-agent`.
- Добавить Fastify.
- Добавить env config.
- Добавить Bearer auth.
- Добавить `/health`.
- Добавить единый формат ошибок.

Готовность:

- Agent запускается.
- Agent запускается через `docker compose`.
- `/health` работает.
- Запрос без токена отклоняется.

### Этап 2. SQLite state

- Добавить SQLite.
- Создать таблицы `peers`, `peer_traffic`, `traffic_snapshots`, `action_log`.
- Добавить repository layer.
- Добавить уникальность по `client`, `public_key`, `assigned_ip`.
- Добавить поля `expires_at`, `traffic_limit_bytes`, `disabled_reason`.

Готовность:

- Можно создать тестовую запись peer в БД.
- Повторный `client` не создает дубль.
- Для peer можно сохранить срок и лимит трафика.

### Этап 3. Чтение AmneziaWG

- Реализовать вызов `awg show awg0 dump`.
- Распарсить runtime-данные.
- Сопоставить runtime по `public_key`.
- Реализовать `GET /peers`.
- Реализовать `GET /peers/:peerId`.
- Реализовать `GET /peers/by-client/:client`.

Готовность:

- API показывает существующие peer и runtime-статус.

### Этап 4. Создание peer

- Реализовать lock.
- Реализовать выбор свободного IP.
- Реализовать генерацию ключей.
- Реализовать генерацию client config.
- Реализовать backup server config.
- Реализовать добавление `[Peer]`.
- Реализовать применение config.
- Реализовать `POST /peers`.
- Поддержать `expiresAt` и `trafficLimitBytes` в запросе.

Готовность:

- Через API можно создать peer.
- Peer появляется в `awg show`.
- Повторный `POST /peers` с тем же `client` возвращает существующий peer.
- Повторный `POST /peers` с новыми лимитами обновляет существующий peer.

### Этап 5. Config и QR

- Реализовать `GET /peers/:peerId/config`.
- Реализовать `GET /peers/by-client/:client/config`.
- Реализовать `GET /peers/:peerId/qr`.
- Реализовать `GET /peers/by-client/:client/qr`.

Готовность:

- Полученный config импортируется в клиент.
- QR импортируется в клиент.

### Этап 6. Disable, enable, delete

- Реализовать отключение peer.
- Реализовать включение peer.
- Реализовать удаление peer.
- Добавить endpoints по `peerId` и по `client`.
- Логировать write-операции в `action_log`.
- Реализовать `PATCH /peers/:peerId/limits`.
- Реализовать `PATCH /peers/by-client/:client/limits`.

Готовность:

- Disabled peer больше не подключается.
- Enabled peer снова подключается.
- Deleted peer исчезает из active config.
- Обновление срока и лимита записывается в `action_log`.

### Этап 7. Учет трафика

- Добавить polling `awg show`.
- Реализовать расчет дельт.
- Обрабатывать сброс runtime-счетчиков.
- Заполнять `peer_traffic`.
- При необходимости писать `traffic_snapshots`.
- Проверять достижение `trafficLimitBytes`.

Готовность:

- `GET /peers` показывает total traffic.
- После restart interface счетчик не уходит в минус и не теряет весь исторический total.
- При достижении заданного лимита трафика peer отключается автоматически.
- Если `traffic_limit_bytes=null`, peer не отключается по трафику.

### Этап 8. Lifecycle и журнал действий

- Добавить scheduler проверки `expires_at`.
- Добавить scheduler проверки лимита трафика, если он не выполнен на traffic polling.
- Реализовать автоотключение с `disabled_reason=expired_at`.
- Реализовать автоотключение с `disabled_reason=traffic_limit`.
- Реализовать `GET /actions`.
- Реализовать `GET /peers/:peerId/actions`.
- Реализовать `GET /peers/by-client/:client/actions`.
- Добавить retention для `action_log`.
- Добавить retention для `traffic_snapshots`.

Готовность:

- Peer отключается после наступления `expires_at`, если срок задан.
- Peer отключается после достижения лимита трафика, если лимит задан.
- Peer без срока и без лимита не отключается scheduler'ом.
- Автоотключение не срабатывает повторно для уже disabled/deleted peer.
- Все ручные и автоматические действия видны через API журнала.

### Этап 9. Установка на сервер

- Разместить сервис.
- Подготовить production compose file.
- Создать директории для volumes:
  - `/var/lib/amnezia-agent`;
  - `/var/backups/amnezia-agent`.
- Настроить env.
- Настроить mount'ы к AmneziaWG config.
- Настроить capabilities/права контейнера.
- При необходимости создать systemd unit, который запускает Docker Compose.
- Настроить firewall/reverse proxy.
- Проверить `/health`.
- Проверить создание тестового peer.

Готовность:

- Agent работает на сервере `amneziya`.
- Agent работает в Docker.
- API доступен только разрешенным клиентам.
- Создание/удаление peer работает через API.

### Этап 10. Интеграция с ботом

- Добавить client к agent в боте.
- Использовать строку `client` как идентификатор.
- Для Telegram формировать `client` по аналогии с 3X-UI.
- Подключить `/vpn`, `/status`, `/block`, `/ban`.
- Передавать `expiresAt` и `trafficLimitBytes` при создании peer.

Готовность:

- Бот создает Amnezia peer через API.
- Повторный `/vpn` не создает дубль.
- `/status` показывает данные agent.
- Истечение срока и лимита трафика применяется на стороне agent, если соответствующие ограничения заданы.
