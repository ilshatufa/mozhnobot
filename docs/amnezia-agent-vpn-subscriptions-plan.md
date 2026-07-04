# План системы VPN-подписок для AmneziaWG через agent

## Цель

Добавить в существующего Telegram-бота поддержку выдачи VPN-доступа через AmneziaWG по аналогии с текущим функционалом для 3X-UI.

Ключевое решение: бот не должен управлять сервером AmneziaWG через SSH. Вместо этого на VPN-сервере поднимается отдельный agent-сервис с HTTP API. Бот обращается к agent по защищенному API, а agent локально управляет AmneziaWG.

## Текущая схема

Сейчас VPN-функционал устроен так:

```text
Telegram user
  |
  v
/vpn
  |
  v
vpnService.getOrCreateKey()
  |
  v
xuiClient.addClient()
  |
  v
3X-UI / Xray
```

Основные файлы:

- `bot/src/handlers/vpn.ts` - команды `/vpn` и `/status`.
- `bot/src/services/vpn.service.ts` - бизнес-логика выдачи VPN.
- `bot/src/services/xui-client.ts` - клиент к API 3X-UI.
- `bot/src/repositories/vpn-key.repository.ts` - работа с таблицей `vpn_keys`.
- `bot/prisma/schema.prisma` - модель `VpnKey`.

## Целевая схема

```text
Telegram user
  |
  v
Telegram bot
  |
  | HTTPS + API token
  v
Amnezia Agent на сервере amneziya
  |
  | локальное управление
  v
/etc/amnezia/amneziawg/awg0.conf + awg
```

Бот отвечает за:

- Telegram-команды.
- Проверку членства пользователя в клубе.
- Блокировки и баны.
- Сроки действия подписок.
- Хранение связки пользователь -> VPN-доступ.
- Отправку конфигов и QR-кодов.

Agent отвечает за:

- Создание peer в AmneziaWG.
- Выбор свободного IP.
- Генерацию ключей.
- Применение конфигурации.
- Отключение peer.
- Чтение runtime-статуса из `awg show`.
- Хранение технического состояния peer на VPN-сервере.

## Agent API

### Авторизация

Все запросы к agent должны требовать токен:

```http
Authorization: Bearer <AMNEZIA_AGENT_TOKEN>
```

Токен должен быть длинным случайным значением и храниться:

- на стороне бота в env;
- на стороне agent в env или systemd environment file.

### `GET /health`

Проверка доступности agent и AmneziaWG.

Ответ:

```json
{
  "ok": true,
  "interface": "awg0",
  "awgActive": true
}
```

### `POST /peers`

Создать новый peer.

Запрос:

```json
{
  "name": "tg_123456789_ivan",
  "expiresAt": "2026-08-02T00:00:00.000Z"
}
```

Agent должен:

1. Взять lock на изменение конфигурации.
2. Прочитать текущее состояние peer.
3. Выбрать свободный IP из клиентской сети, например `10.9.9.0/24`.
4. Сгенерировать client private key, public key и preshared key.
5. Добавить peer в серверный конфиг.
6. Применить изменения через `awg syncconf` или другой безопасный механизм.
7. Сохранить peer в локальную базу agent.
8. Вернуть клиентский конфиг.

Ответ:

```json
{
  "peerId": "client_public_key",
  "name": "tg_123456789_ivan",
  "assignedIp": "10.9.9.4/32",
  "publicKey": "client_public_key",
  "config": "[Interface]\n...",
  "expiresAt": "2026-08-02T00:00:00.000Z"
}
```

### `GET /peers/:peerId/status`

Получить runtime-статус peer.

Ответ:

```json
{
  "peerId": "client_public_key",
  "assignedIp": "10.9.9.4/32",
  "enabled": true,
  "latestHandshakeAt": "2026-07-02T04:20:00.000Z",
  "rxBytes": 123456,
  "txBytes": 987654,
  "endpoint": "178.178.xxx.xxx:33080"
}
```

Endpoint можно маскировать на стороне бота перед отправкой пользователю.

### `GET /peers/:peerId/config`

Вернуть сохраненный клиентский конфиг для повторной выдачи пользователю.

Ответ:

```json
{
  "peerId": "client_public_key",
  "config": "[Interface]\n..."
}
```

### `POST /peers/:peerId/disable`

Отключить peer без удаления записи.

Agent должен:

1. Пометить peer как disabled в своей базе.
2. Убрать peer из активного server config или применить эквивалентное отключение.
3. Применить конфигурацию.

Ответ:

```json
{
  "ok": true
}
```

### `POST /peers/:peerId/enable`

Включить ранее отключенный peer.

Ответ:

```json
{
  "ok": true
}
```

### `DELETE /peers/:peerId`

Удалить peer окончательно.

Для MVP можно использовать `disable`, а физическое удаление оставить на отдельную админскую операцию.

## Хранение состояния agent

Agent должен иметь локальную SQLite-базу на сервере AmneziaWG.

Пример таблицы `peers`:

```text
id
name
public_key
private_key_encrypted
preshared_key_encrypted
assigned_ip
config_text_encrypted
enabled
created_at
expires_at
disabled_at
deleted_at
```

Важно: если нужно повторно выдавать тот же конфиг через `/vpn`, agent должен хранить client private key или готовый client config. Иначе повторная выдача невозможна, останется только перевыпуск peer.

Для MVP лучше хранить готовый client config в зашифрованном виде.

## Изменения в боте

### Новый client

Добавить файл:

```text
bot/src/services/amnezia-agent-client.ts
```

Методы:

```ts
createPeer(name: string, expiresAt: Date): Promise<AmneziaPeer>
getPeerConfig(peerId: string): Promise<string>
getPeerStatus(peerId: string): Promise<AmneziaPeerStatus>
disablePeer(peerId: string): Promise<void>
enablePeer(peerId: string): Promise<void>
deletePeer(peerId: string): Promise<void>
```

### Provider-интерфейс

Вынести общий интерфейс для VPN-провайдеров:

```ts
interface VpnProvider {
  createAccess(user: User, expiresAt: Date): Promise<VpnAccess>;
  getAccessConfig(access: VpnKey): Promise<string>;
  getAccessStatus(access: VpnKey): Promise<VpnRuntimeStatus>;
  disableAccess(access: VpnKey, user: User): Promise<void>;
}
```

Реализации:

- `XuiVpnProvider`
- `AmneziaVpnProvider`

`vpn.service.ts` должен выбирать provider по конфигу:

```text
VPN_PROVIDER=XUI
VPN_PROVIDER=AMNEZIA
```

### Команда `/vpn`

Для Amnezia сценарий должен быть таким:

1. Проверить `vpnBlocked`.
2. Найти активный ключ пользователя.
3. Если ключ есть, запросить у agent сохраненный config и выдать повторно.
4. Если ключа нет:
   - создать peer через agent;
   - сохранить запись в БД;
   - отправить пользователю `.conf` и QR.

### Команда `/status`

Для Amnezia показывать:

- активен / истек / заблокирован / отсутствует;
- срок действия;
- последний handshake;
- трафик;
- краткий endpoint, если нужен.

### `/block`, `/ban`

Текущий механизм должен продолжить работать через `vpnService.disableKeysForUser()`.

Для Amnezia это должно вызывать:

```text
POST /peers/:peerId/disable
```

и затем помечать ключ в БД как неактивный.

## Изменения в базе бота

Текущая модель `VpnKey` заточена под 3X-UI:

```text
xuiClientId
subId
subscriptionUrl
```

Нужно сделать модель универсальнее.

Предлагаемые поля:

```text
provider
providerClientId
subId
subscriptionUrl
configText
assignedIp
publicKey
createdAt
expiresAt
isActive
revokedAt
```

Где:

- `provider` - `XUI` или `AMNEZIA`.
- `providerClientId` - ID клиента у провайдера. Для Amnezia это public key peer.
- `subscriptionUrl` - для XUI ссылка подписки.
- `configText` - для Amnezia client config, если решим хранить его в БД бота.
- `assignedIp` - IP peer в AmneziaWG.
- `publicKey` - public key peer.
- `revokedAt` - когда доступ был отозван.

Важное решение: для Amnezia лучше хранить config в agent, а в БД бота хранить только `providerClientId`, `assignedIp` и метаданные. Тогда бот при повторной выдаче запрашивает config у agent.

Миграции делать только через Prisma tooling внутри Docker.

## Конфигурация

Добавить env-переменные:

```env
VPN_PROVIDER=AMNEZIA

AMNEZIA_AGENT_BASE_URL=https://agent.example.com
AMNEZIA_AGENT_TOKEN=long-random-token
AMNEZIA_AGENT_TIMEOUT_MS=10000

AMNEZIA_SETUP_IMAGE_FILE_ID=
AMNEZIA_SETUP_IMAGE_FILE_ID_2=
```

Для agent:

```env
AMNEZIA_AGENT_TOKEN=long-random-token
AMNEZIA_INTERFACE=awg0
AMNEZIA_SERVER_HOST=138.124.96.168
AMNEZIA_SERVER_PORT=51820
AMNEZIA_CLIENT_CIDR=10.9.9.0/24
AMNEZIA_DNS=1.1.1.1
AMNEZIA_CONFIG_PATH=/etc/amnezia/amneziawg/awg0.conf
AMNEZIA_AGENT_DB_PATH=/var/lib/amnezia-agent/agent.db
```

## Безопасность

Agent нельзя оставлять просто открытым в интернет без защиты.

Минимальные требования:

- HTTPS.
- `Authorization: Bearer`.
- Длинный случайный токен.
- Rate limit.
- Audit log всех операций.
- Приватные ключи не писать в логи.
- Backup server config перед каждым изменением.
- Lock на изменение config.

Лучший вариант доступа:

```text
bot -> private network -> agent
```

Если private network нет, то:

- reverse proxy с TLS;
- firewall allowlist по IP сервера с ботом;
- API token;
- желательно отдельный нестандартный порт.

## Systemd для agent

Agent должен работать как отдельный сервис:

```text
amnezia-agent.service
```

Сервисный пользователь:

```text
amnezia-agent
```

Права:

- читать и писать свою SQLite-базу;
- читать/изменять конфиг AmneziaWG через ограниченный механизм;
- выполнять только нужные команды управления `awg`.

Не рекомендуется запускать agent как `root`, если можно сделать ограниченный `sudoers`.

## Worker для истекших подписок

Сейчас активность ключа определяется по `expiresAt`, но peer на VPN-сервере сам не отключится.

Нужно добавить worker в бот:

1. Раз в 5-15 минут искать активные истекшие ключи.
2. Для Amnezia вызывать `disablePeer`.
3. Помечать ключ как inactive.
4. Логировать результат.

## MVP

Минимальный объем первой версии:

1. Agent:
   - `GET /health`
   - `POST /peers`
   - `GET /peers/:peerId/config`
   - `GET /peers/:peerId/status`
   - `POST /peers/:peerId/disable`
2. Бот:
   - `AmneziaAgentClient`
   - `AmneziaVpnProvider`
   - переключатель `VPN_PROVIDER`
   - `/vpn` выдает `.conf` и QR
   - повторный `/vpn` возвращает существующий конфиг
   - `/status` показывает срок и handshake
   - `/block` и `/ban` отключают peer
3. БД:
   - добавить provider-поля к `vpn_keys`
   - сохранить совместимость со старыми XUI-ключами
4. Worker:
   - отключение истекших Amnezia peer

## Этапы внедрения

### Этап 0. Фиксация решений

Цель: закрыть архитектурные развилки до разработки.

Задачи:

- Решить, остается ли 3X-UI как параллельный provider после запуска Amnezia.
- Решить, где хранить Amnezia client config: только в agent или также в БД бота.
- Решить, нужен ли публичный subscription URL или достаточно выдачи `.conf` и QR через Telegram.
- Решить, нужен ли лимит трафика в MVP или только срок действия.
- Зафиксировать первый сервер: `amneziya`, interface `awg0`, порт `51820`.

Результат:

- Приняты решения по открытым вопросам.
- Известен минимальный scope MVP.

Готовность:

- Можно начинать миграцию БД и разработку agent без переделок на старте.

### Этап 1. Подготовка модели данных бота

Цель: сделать текущую таблицу VPN-ключей пригодной для нескольких провайдеров.

Задачи:

- Добавить enum `VpnProvider`: `XUI`, `AMNEZIA`.
- Расширить `VpnKey` полями:
  - `provider`;
  - `providerClientId`;
  - `assignedIp`;
  - `publicKey`;
  - `revokedAt`.
- Оставить старые поля `xuiClientId`, `subId`, `subscriptionUrl` совместимыми с текущими XUI-ключами.
- Создать миграцию Prisma только через Docker.
- Выполнить `prisma generate` внутри Docker.
- Перезапустить сервисы, которые импортируют Prisma Client.

Результат:

- Бот умеет хранить и XUI, и Amnezia-доступы в одной модели.

Готовность:

- Старые команды `/vpn` и `/status` продолжают работать с XUI.
- Существующие записи `vpn_keys` не сломаны.

### Этап 2. Provider-интерфейс в боте

Цель: убрать прямую зависимость `vpn.service.ts` от `xuiClient`.

Задачи:

- Создать общий `VpnProvider` interface.
- Перенести текущую XUI-логику в `XuiVpnProvider`.
- Добавить выбор provider через `VPN_PROVIDER`.
- Сохранить текущий пользовательский сценарий `/vpn`.
- Сохранить текущий сценарий `/status`.
- Сохранить текущую работу `/block` и `/ban`.

Результат:

- Бот архитектурно готов подключить Amnezia без переписывания handler'ов.

Готовность:

- При `VPN_PROVIDER=XUI` поведение бота такое же, как до изменений.

### Этап 3. Проектирование и каркас agent

Цель: создать отдельный сервис agent без опасных операций с AmneziaWG на первом шаге.

Задачи:

- Создать отдельный проект agent на Node.js/TypeScript.
- Добавить конфиг agent через env.
- Реализовать авторизацию `Authorization: Bearer`.
- Реализовать `GET /health`.
- Подключить SQLite.
- Создать таблицу `peers`.
- Добавить audit log.
- Добавить единый формат ошибок API.

Результат:

- Agent запускается локально и отвечает на `/health`.
- Есть база состояния и авторизация.

Готовность:

- Запрос без токена отклоняется.
- Запрос с токеном проходит.
- `/health` возвращает состояние сервиса.

### Этап 4. Локальное управление AmneziaWG в agent

Цель: научить agent безопасно создавать, читать и отключать peer.

Задачи:

- Реализовать lock на операции изменения.
- Реализовать backup `awg0.conf` перед изменениями.
- Реализовать парсер текущих peer/IP из server config и `awg show`.
- Реализовать выбор свободного IP.
- Реализовать генерацию ключей.
- Реализовать добавление peer в server config.
- Реализовать применение config через `awg syncconf` или согласованный безопасный механизм.
- Реализовать отключение peer.
- Реализовать получение runtime-статуса peer.

API этапа:

- `POST /peers`
- `GET /peers/:peerId/config`
- `GET /peers/:peerId/status`
- `POST /peers/:peerId/disable`

Результат:

- Agent умеет управлять AmneziaWG на тестовом окружении.

Готовность:

- Созданный peer появляется в `awg show`.
- Повторно выдается тот же config.
- Disabled peer больше не активен.
- При ошибке остается backup конфига.

### Этап 5. Установка agent на сервер `amneziya`

Цель: развернуть agent рядом с AmneziaWG.

Задачи:

- Создать пользователя `amnezia-agent`.
- Разместить agent на сервере.
- Создать `/var/lib/amnezia-agent`.
- Настроить env-файл.
- Настроить systemd unit.
- Настроить ограниченный доступ к agent.
- Проверить `/health`.
- Создать тестовый peer через API.
- Проверить подключение тестового клиента.
- Удалить или отключить тестовый peer.

Результат:

- Agent работает на реальном сервере и управляет `awg0`.

Готовность:

- `systemctl status amnezia-agent` активен.
- `GET /health` успешен.
- Тестовый peer создается и отключается.

### Этап 6. Интеграция Amnezia provider в бота

Цель: подключить Telegram-бота к agent.

Задачи:

- Добавить `amnezia-agent-client.ts`.
- Добавить `AmneziaVpnProvider`.
- Добавить env:
  - `AMNEZIA_AGENT_BASE_URL`;
  - `AMNEZIA_AGENT_TOKEN`;
  - `AMNEZIA_AGENT_TIMEOUT_MS`.
- В `/vpn` для Amnezia выдавать `.conf` файлом.
- Генерировать и отправлять QR.
- В `/status` показывать срок, handshake и трафик.
- Не показывать приватные данные в логах.

Результат:

- Пользователь может получить Amnezia config через текущую команду `/vpn`.

Готовность:

- Новый пользователь получает конфиг.
- Повторный `/vpn` возвращает тот же конфиг.
- `/status` показывает runtime-данные из agent.

### Этап 7. Блокировки, истечения и обслуживание

Цель: довести жизненный цикл подписки до рабочего состояния.

Задачи:

- Подключить `disableAccess` для Amnezia к `/block` и `/ban`.
- Добавить worker для истекших подписок.
- Worker должен:
  - находить активные истекшие Amnezia-ключи;
  - вызывать `disablePeer`;
  - помечать ключ неактивным;
  - логировать результат.
- Добавить обработку недоступности agent.
- Добавить повторные попытки для временных ошибок.

Результат:

- Истекшие и заблокированные пользователи реально отключаются на AmneziaWG.

Готовность:

- `/block` отключает peer.
- `/ban` отключает peer.
- Истекший ключ отключается автоматически.
- Ошибка agent не ломает весь бот.

### Этап 8. Тестирование полного сценария

Цель: проверить весь пользовательский путь.

Сценарии:

- Новый пользователь получает Amnezia config.
- Пользователь подключается с iOS/Android.
- Бот видит handshake.
- Повторный `/vpn` возвращает тот же config.
- `/status` показывает актуальный срок.
- `/block` отключает доступ.
- `/unblock` не создает доступ автоматически, пользователь снова идет через `/vpn`.
- Истекший ключ отключается worker.
- Старый XUI-сценарий работает, если `VPN_PROVIDER=XUI`.

Результат:

- MVP можно включать для реальных пользователей.

Готовность:

- Все основные сценарии пройдены вручную.
- Логи не содержат private key.
- В БД нет дублей активных ключей для одного пользователя.

### Этап 9. Продакшен-защита

Цель: закрыть риски перед постоянной эксплуатацией.

Задачи:

- Ограничить доступ к agent по IP или private network.
- Включить HTTPS.
- Проверить token rotation plan.
- Проверить backup и rollback `awg0.conf`.
- Проверить права systemd service.
- Проверить, что agent не работает как root без необходимости.
- Настроить лог-ротацию.
- Настроить мониторинг `/health`.
- Документировать ручное восстановление после сбоя.

Результат:

- Agent и бот готовы к стабильной эксплуатации.

Готовность:

- Agent недоступен без токена.
- Agent недоступен из лишних сетей.
- Есть понятный rollback.
- Есть понятный способ перевыпустить токен.

## Открытые решения

1. Хранить client config только в agent или также в БД бота.
2. Нужна ли публичная subscription-ссылка или достаточно выдачи `.conf`/QR через Telegram.
3. Сколько серверов Amnezia нужно поддержать в первой версии.
4. Нужно ли делать лимиты трафика в MVP или только срок действия.
5. Нужно ли оставлять параллельную поддержку 3X-UI после включения Amnezia.
