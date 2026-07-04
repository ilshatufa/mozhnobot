# AmneziaWG: установка, agent, peer'ы, лимиты и диагностика

Дата фиксации: 2026-07-04.

Документ фиксирует практические сведения по AmneziaWG-серверам и нашему `amneziya-agent`. Это эксплуатационная памятка: что ставится на сервер, как создаются peer'ы, где хранятся конфиги/QR, как считаются лимиты и как диагностировать обрывы. Приватные ключи, API-токены и рабочие конфиги клиентов здесь не хранятся.

## Общая схема

```text
Telegram bot / backend
  |
  | HTTPS + Authorization: Bearer <token>
  v
amneziya-agent на VPN-сервере
  |
  | локальные команды awg + правка awg0.conf
  v
AmneziaWG interface awg0
```

Ключевое правило: бот не ходит на VPN-сервер по SSH для создания ключей. Все операции с peer'ами идут через `amneziya-agent`.

Agent является единственной штатной точкой изменения:

- `/etc/amnezia/amneziawg/awg0.conf`;
- локальной SQLite-базы agent;
- включения/отключения peer'ов;
- учета трафика;
- выдачи сохраненного `.conf` и QR.

## Серверы

Текущая логика поддерживает несколько Amnezia-серверов. У пользователя может быть несколько VPN-ключей, но не больше одного ключа на один сервер.

Операционные SSH-имена:

- `ssh amneziya1` / старое `ssh amneziya` - первый сервер, Stockholm;
- `ssh amneziya2` - Dronten;
- `ssh amneziya3` - Paris.

Рекомендуемые коды серверов:

- `se` - Stockholm;
- `nl` - Dronten;
- `fr` - Paris.

Файл конфига для пользователя должен называться понятно:

```text
amneziya-se.mozhno.org.conf
amneziya-nl.mozhno.org.conf
amneziya-fr.mozhno.org.conf
```

В боте имя файла строится по коду сервера:

```text
amneziya-<serverCode>.mozhno.org.conf
```

## Что ставится на VPN-сервер

На каждом VPN-сервере нужны:

- AmneziaWG;
- интерфейс `awg0`;
- рабочий серверный config `awg0.conf`;
- firewall с открытым UDP-портом AmneziaWG;
- fail2ban/базовая защита SSH;
- Docker/Compose для `amneziya-agent`;
- reverse proxy/TLS для публичного API, если API доступен извне;
- `amneziya-agent` с доступом к `awg` и `awg0.conf`.

Важно: старые панели типа `wg-easy` на сервере надо удалить перед эксплуатацией, чтобы не было второго владельца WireGuard/AmneziaWG-конфига.

## Docker-only для agent

В этом репозитории все процессы platform-кода запускаются только через Docker.

Локально:

```bash
docker compose up amneziya
docker compose exec amneziya npm test
docker compose exec amneziya npm run build
```

Не запускать на host напрямую:

```text
npm
node
tsx
jest
vite
prisma
```

Production-agent на VPN-сервере тоже должен работать в контейнере. Ему нужны mount'ы:

```text
/etc/amnezia/amneziawg:/etc/amnezia/amneziawg
/var/lib/amnezia-agent:/var/lib/amnezia-agent
/var/backups/amnezia-agent:/var/backups/amnezia-agent
```

Минимальная идея: контейнер содержит приложение agent, а доступ к `awg`/`awg-quick` и системному интерфейсу должен быть явно настроен. Если контейнер не может безопасно управлять `awg0`, можно вынести применение конфига в небольшой host-side helper, но один источник истины все равно должен оставаться у agent.

## Env agent

Основные переменные из фактического кода `amneziya/src/config.ts`:

```env
AMNEZIA_AGENT_TOKEN=long-random-token
AMNEZIA_AGENT_HOST=0.0.0.0
AMNEZIA_AGENT_PORT=8080

AMNEZIA_INTERFACE=awg0
AMNEZIA_SERVER_HOST=srv1.amneziya.mozhno.org
AMNEZIA_SERVER_PORT=51820
AMNEZIA_CLIENT_CIDR=10.9.9.0/24
AMNEZIA_DNS=1.1.1.1
AMNEZIA_MTU=1280
AMNEZIA_PERSISTENT_KEEPALIVE=15

AMNEZIA_CONFIG_PATH=/etc/amnezia/amneziawg/awg0.conf
AMNEZIA_AGENT_DB_PATH=/var/lib/amnezia-agent/agent.db
AMNEZIA_BACKUP_DIR=/var/backups/amnezia-agent

AMNEZIA_TRAFFIC_POLL_INTERVAL_MS=60000
AMNEZIA_EXPIRATION_POLL_INTERVAL_MS=60000
AMNEZIA_ACTION_LOG_RETENTION_DAYS=180
AMNEZIA_TRAFFIC_SNAPSHOT_RETENTION_DAYS=30

AMNEZIA_PUBLIC_BASE_URL=https://srv1.amneziya.mozhno.org
AMNEZIA_DOWNLOAD_TTL_SECONDS=600
AMNEZIA_DOWNLOAD_FILENAME=amneziya-se.mozhno.org.conf
```

`AMNEZIA_AGENT_TOKEN` должен быть длинным случайным значением. В production нельзя оставлять dev-токен.

## Env бота

Основные переменные для интеграции бота:

```env
VPN_AMNEZIA_SERVER_CODE=se
VPN_AMNEZIA_SERVER_NAME=Amnezia SE / Stockholm
VPN_AMNEZIA_API_BASE_URL=https://srv1.amneziya.mozhno.org
VPN_AMNEZIA_API_TOKEN=long-random-token
VPN_AMNEZIA_CONFIG_BASE_URL=https://amneziya.mozhno.org
VPN_TRAFFIC_LIMIT_GB=30
```

Серверы Amnezia хранятся в таблице `VpnServer`. Бот вызывает `ensureConfiguredServers()` и заводит/обновляет базовый сервер из env. Дополнительные серверы можно хранить в БД как активные `VpnServer` с provider `AMNEZIA`.

## API agent

Все endpoints требуют:

```http
Authorization: Bearer <AMNEZIA_AGENT_TOKEN>
```

### Health

```http
GET /health
```

Проверяет доступность agent и `awg show <interface>`.

### Peer'ы

```http
GET /peers
GET /peers?includeDeleted=true

POST /peers
GET /peers/:peerId
GET /peers/by-client/:client

GET /peers/:peerId/config
GET /peers/by-client/:client/config

GET /peers/:peerId/qr
GET /peers/by-client/:client/qr

POST /peers/:peerId/disable
POST /peers/by-client/:client/disable

POST /peers/:peerId/enable
POST /peers/by-client/:client/enable

PATCH /peers/:peerId/limits
PATCH /peers/by-client/:client/limits

DELETE /peers/:peerId
DELETE /peers/by-client/:client
```

Создание peer:

```json
{
  "client": "tg_123456789",
  "expiresAt": "2026-08-04T00:00:00.000Z",
  "trafficLimitBytes": 32212254720
}
```

Без лимитов:

```json
{
  "client": "tg_123456789",
  "expiresAt": null,
  "trafficLimitBytes": null
}
```

Правила:

- `client` - внешний строковый идентификатор, по нему бот связывает Telegram-пользователя и peer;
- `client` должен быть ASCII и соответствовать regex `^[a-zA-Z0-9_.@:-]+$`;
- `expiresAt = null` означает без ограничения по сроку;
- `trafficLimitBytes = null` означает без ограничения по трафику;
- если оба значения `null`, peer работает без лимитов;
- если peer с таким `client` уже есть, создание идемпотентно: agent возвращает существующий peer и может обновить переданные лимиты.

### Download links

Для мобильного Telegram есть отдельный механизм загрузки `.conf`, чтобы не отправлять всё содержимое в чат.

```http
POST /downloads
GET /downloads/:token
HEAD /downloads/:token
```

Создание ссылки:

```json
{
  "client": "tg_123456789"
}
```

Ссылка живет `AMNEZIA_DOWNLOAD_TTL_SECONDS`, по умолчанию 600 секунд. После использования token помечается как used.

## Как создается peer

Agent делает:

1. Проверяет, есть ли активный peer с таким `client`.
2. Читает runtime peer'ы через `awg show awg0 dump`.
3. Берет занятые IP из runtime и локальной базы.
4. Выбирает свободный IP из `AMNEZIA_CLIENT_CIDR`.
5. Генерирует client private key.
6. Вычисляет client public key.
7. Генерирует preshared key.
8. Читает server public key.
9. Добавляет `[Peer]` в `awg0.conf`.
10. Применяет конфиг через:

```bash
awg syncconf awg0 <(awg-quick strip /etc/amnezia/amneziawg/awg0.conf)
```

11. Сохраняет peer в SQLite.
12. Сохраняет готовый client config.
13. Создает начальную запись traffic.
14. Пишет action log.
15. Возвращает peer, config и runtime-данные.

В server config блок peer помечается комментарием:

```text
# amneziya-agent client=<client> createdAt=<iso-date>
[Peer]
PublicKey = ...
PresharedKey = ...
AllowedIPs = ...
```

## Клиентский config

Agent сохраняет готовый client config в базе, чтобы бот мог повторно выдать тот же файл и QR без перевыпуска peer.

Важные поля:

```text
[Interface]
PrivateKey = ...
Address = <assigned-ip>
DNS = <AMNEZIA_DNS>
MTU = <AMNEZIA_MTU>

[Peer]
PublicKey = <server-public-key>
PresharedKey = ...
Endpoint = <AMNEZIA_SERVER_HOST>:<AMNEZIA_SERVER_PORT>
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = <AMNEZIA_PERSISTENT_KEEPALIVE>
```

Для стабильности на мобильных сетях у нас важны:

- `MTU=1280`;
- `PersistentKeepalive=15`;
- корректный UDP-порт;
- отсутствие второго сервиса, который перезаписывает `awg0.conf`;
- совпадение endpoint с реальным доменом/IP сервера.

## Хранение данных agent

Agent использует SQLite:

```text
/var/lib/amnezia-agent/agent.db
```

Фактические таблицы:

- `peers`;
- `peer_traffic`;
- `traffic_snapshots`;
- `action_log`;
- `download_tokens`.

### `peers`

Хранит:

- внешний `client`;
- `public_key`;
- `private_key`;
- `preshared_key`;
- `assigned_ip`;
- сохраненный `config_text`;
- `enabled`;
- `expires_at`;
- `traffic_limit_bytes`;
- `disabled_at`;
- `disabled_reason`;
- `deleted_at`;
- timestamps.

Ограничения:

- активный `client` уникален;
- активный `assigned_ip` уникален;
- `public_key` уникален.

### `peer_traffic`

Хранит накопительные счетчики:

- `total_rx_bytes`;
- `total_tx_bytes`;
- `last_rx_bytes`;
- `last_tx_bytes`;
- `last_sampled_at`;
- `updated_at`.

Agent считает общий использованный трафик как:

```text
trafficUsedBytes = total_rx_bytes + total_tx_bytes
```

### `action_log`

Пишет операции:

- `peer_created`;
- `peer_returned_existing`;
- `peer_limits_updated`;
- `peer_disabled`;
- `peer_enabled`;
- `peer_deleted`;
- `peer_auto_disabled`;
- `traffic_sampled`;
- `config_returned`;
- `qr_returned`;
- `download_link_created`;
- `config_downloaded`.

## Как считается трафик

AmneziaWG runtime показывает текущие счетчики через:

```bash
awg show awg0 dump
```

Agent раз в `AMNEZIA_TRAFFIC_POLL_INTERVAL_MS`:

1. читает runtime peer'ы;
2. сопоставляет peer по `public_key`;
3. сравнивает текущие `rxBytes/txBytes` с прошлым sample;
4. добавляет дельту в `total_rx_bytes/total_tx_bytes`;
5. пишет snapshot;
6. проверяет лимит трафика.

По умолчанию интервал 60 секунд.

Важно: если интерфейс/сервер перезапустился и runtime-счетчики сбросились, agent должен не вычитать трафик назад. Накопительные `total_*` в SQLite остаются источником долгосрочного учета.

## Лимиты

Есть два уровня.

### Лимит peer на agent

Поля:

```text
expires_at
traffic_limit_bytes
```

Agent сам отключает peer, если:

```text
now >= expires_at
```

или:

```text
total_rx_bytes + total_tx_bytes >= traffic_limit_bytes
```

Если поле `null`, соответствующий лимит не применяется.

### Общий лимит пользователя в боте

В боте есть логика общего лимита по пользователю для всех Amnezia-ключей. Это нужно, потому что пользователь может иметь ключи на нескольких Amnezia-серверах.

Идея:

- бот хранит `trafficLimitBytes` и `trafficUsedBytes` в `VpnKey`;
- sync-service периодически опрашивает agent'ы;
- суммирует usage по всем активным Amnezia-ключам пользователя;
- если общий лимит превышен, отключает активные Amnezia-ключи пользователя с reason `global_traffic_limit`.

По умолчанию бизнес-лимит:

```text
30 GB на 30 дней
```

В коде текущий env default может отличаться, поэтому production `.env` должен явно задавать нужное значение.

## Бот

Сценарий `/vpn`:

1. Пользователь нажимает `/vpn`.
2. Бот показывает кнопки:
   - `Amnezia`;
   - `3xui`.
3. По `Amnezia` показывает список активных Amnezia-серверов.
4. Пользователь выбирает сервер.
5. Бот вызывает `vpnService.getOrCreateAmneziyaKey(user, serverCode)`.
6. Если ключ уже есть для этого сервера, бот берет сохраненные `configText` и `qrPngBase64` из БД.
7. Если ключа нет, бот вызывает agent `POST /peers`.
8. Бот сохраняет:
   - provider `AMNEZIA`;
   - serverId;
   - providerClientId;
   - providerPeerId;
   - configText;
   - qrPngBase64;
   - expiresAt;
   - trafficLimitBytes;
   - trafficUsedBytes;
   - lastSyncedAt.
9. Бот отправляет `.conf`, QR и кнопку загрузки.

Повторная выдача не должна перевыпускать peer, если ключ уже есть.

## Почему config и QR хранятся в базе

Это сделано, чтобы бот отвечал быстро и не дергал agent каждый раз.

Плюсы:

- повторный `/vpn` быстрее;
- Telegram может заново получить файл/QR без перевыпуска;
- меньше сетевых ошибок из-за удаленного agent;
- меньше задержек в чате.

Риски:

- `configText` содержит private key клиента;
- базу бота надо защищать как секретное хранилище;
- в логи нельзя писать config/QR.

## Проверка agent

Через API:

```bash
curl -sS \
  -H "Authorization: Bearer $AMNEZIA_AGENT_TOKEN" \
  https://srv1.amneziya.mozhno.org/health
```

Список peer'ов:

```bash
curl -sS \
  -H "Authorization: Bearer $AMNEZIA_AGENT_TOKEN" \
  https://srv1.amneziya.mozhno.org/peers
```

Peer по client:

```bash
curl -sS \
  -H "Authorization: Bearer $AMNEZIA_AGENT_TOKEN" \
  https://srv1.amneziya.mozhno.org/peers/by-client/tg_123456789
```

Создать временную download-ссылку:

```bash
curl -sS \
  -H "Authorization: Bearer $AMNEZIA_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client":"tg_123456789"}' \
  https://srv1.amneziya.mozhno.org/downloads
```

## Проверка на сервере

Состояние сервиса:

```bash
docker compose ps
docker compose logs --tail=200 amneziya
```

Состояние интерфейса:

```bash
ip addr show awg0
awg show awg0
awg show awg0 dump
```

Порт:

```bash
ss -lunp | grep 51820
```

Firewall:

```bash
ufw status verbose
iptables -S
iptables -t nat -S
```

Маршрутизация/NAT:

```bash
sysctl net.ipv4.ip_forward
sysctl net.ipv6.conf.all.forwarding
```

## Диагностика обрывов

Проверять одновременно:

1. Есть ли handshake у peer.
2. Обновляется ли endpoint.
3. Растут ли `transfer` в `awg show`.
4. Растут ли счетчики agent.
5. Нет ли рестартов контейнера/интерфейса.
6. Не меняется ли пользовательская сеть между Wi-Fi/LTE.
7. Не конфликтует ли MTU.

Команды:

```bash
watch -n 2 'awg show awg0'
docker compose logs -f --tail=100 amneziya
```

Если handshake есть, но интернет не работает:

- проверить NAT;
- проверить `AllowedIPs = 0.0.0.0/0, ::/0`;
- проверить DNS в клиентском config;
- попробовать DNS `1.1.1.1` или `8.8.8.8`;
- проверить `MTU=1280`;
- проверить firewall forward rules.

Если handshake пропадает:

- проверить UDP-порт снаружи;
- проверить, не блокирует ли провайдер UDP;
- попробовать другой порт;
- проверить `PersistentKeepalive=15`;
- проверить, не переписал ли config сторонний сервис.

Если соединение рвется только на мобильной сети:

- оставить `MTU=1280`;
- `PersistentKeepalive=15`;
- протестировать другой UDP-порт;
- сравнить с конфигом, который работает у коммерческого провайдера;
- смотреть `latest handshake` и смену endpoint.

## Проверка download на мобильном Telegram

Проблема: Telegram Desktop может скачать `.conf`, а мобильный Telegram иногда неудобно обрабатывает присланный файл.

Решение: кнопка загрузки через `/downloads/:token`.

Проверить:

- `POST /downloads` возвращает URL;
- `HEAD /downloads/:token` возвращает `Content-Disposition`;
- `GET /downloads/:token` скачивает файл с именем `amneziya-<server>.mozhno.org.conf`;
- после первого использования повторный `GET` должен вернуть 404;
- token истекает через `AMNEZIA_DOWNLOAD_TTL_SECONDS`.

## Безопасность

Минимум:

- API только через HTTPS;
- Bearer token обязателен;
- токен длинный и отдельный для production;
- rate limit включен;
- action log включен;
- config/private key/QR не писать в логи;
- firewall ограничивает лишние порты;
- SSH защищен ключами/fail2ban;
- регулярные backup'и `awg0.conf` и `agent.db`;
- один владелец `awg0.conf`: agent.

Публичная доступность API допустима, если API предназначен для backend, а не для пользователей:

- endpoint публично маршрутизируется;
- все операции закрыты Bearer token;
- желательно allowlist IP backend-сервера;
- пользователь не получает API token;
- пользователь получает только `.conf`, QR или download URL.

## Что не хранить в документах

Не фиксировать в репозитории:

- `AMNEZIA_AGENT_TOKEN`;
- client private key;
- preshared key;
- полный рабочий `.conf`;
- QR-код реального клиента;
- SQLite `agent.db`;
- backup `awg0.conf` с реальными peer'ами;
- реальные Telegram ID, если документ может уйти наружу.

Можно фиксировать:

- доменные имена;
- коды серверов;
- имена env-переменных;
- API-контракты;
- безопасные шаблоны команд;
- принципы подсчета трафика;
- типовые диагностические сценарии.

## Полезные ссылки внутри проекта

- [amneziya/README.md](../amneziya/README.md)
- [docs/amnezia-agent-wrapper-service-plan.md](./amnezia-agent-wrapper-service-plan.md)
- [docs/amnezia-agent-vpn-subscriptions-plan.md](./amnezia-agent-vpn-subscriptions-plan.md)
- [amneziya/src/config.ts](../amneziya/src/config.ts)
- [amneziya/src/routes/peers.ts](../amneziya/src/routes/peers.ts)
- [amneziya/src/services/peer.service.ts](../amneziya/src/services/peer.service.ts)
- [amneziya/src/db/database.ts](../amneziya/src/db/database.ts)
