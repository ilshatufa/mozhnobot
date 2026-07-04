# 3x-ui: установка, домены, сертификаты и создание подключений

Дата фиксации: 2026-07-04.

Документ фиксирует практические сведения, которые пригодились при настройке 3x-ui/Xray серверов `srv1.xui.mozhno.org` и `srv2.xui.mozhno.org`. Приватные токены, пароли, UUID клиентов и приватные Reality-ключи здесь не хранятся.

## Серверы и роли

- `ssh 3xuiru` - RU-сервер, домен `srv1.xui.mozhno.org`.
- `ssh 3xuide` - DE-сервер, домен `srv2.xui.mozhno.org`.
- `ssh tgproxy2ru` - российская точка для проверок без влияния локального VPN на рабочей машине.

Для проверки блокировок/доступности с российских сетей не надо полагаться на локальную машину, если на ней включен VPN. Проверки лучше запускать с `tgproxy2ru` или другого контрольного российского сервера.

## Установка 3x-ui

На чистом сервере 3x-ui ставится штатным установщиком проекта. Перед установкой проверить, что нет старых панелей и сервисов, которые занимают нужные порты.

Типовой порядок:

```bash
ssh <server>

apt update
apt install -y curl socat cron

# Установка 3x-ui официальным скриптом проекта.
# Перед использованием лучше сверить актуальный URL в репозитории 3x-ui.
bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh)
```

После установки:

```bash
systemctl status x-ui
x-ui
```

Через CLI `x-ui` можно посмотреть или изменить:

- порт панели;
- web base path;
- логин;
- пароль;
- настройки сертификата панели;
- включение/отключение сервиса.

## DNS

Для каждого сервера заводится отдельная A-запись:

- `srv1.xui.mozhno.org` -> IP RU-сервера;
- `srv2.xui.mozhno.org` -> IP DE-сервера.

Если используется Cloudflare, для Xray-портов запись должна быть в режиме DNS only, без proxy/orange cloud. Иначе нестандартный Xray-трафик не будет доходить до сервера как обычное TCP/TLS-соединение.

Проверки:

```bash
dig +short srv2.xui.mozhno.org
curl -vk https://srv2.xui.mozhno.org:<panel-port>/<panel-path>/
```

## Сертификаты

Для Xray TLS inbound нужен обычный публично доверенный сертификат Let's Encrypt на домен сервера.

Типовой выпуск:

```bash
apt install -y certbot
certbot certonly --standalone -d srv2.xui.mozhno.org
```

Важно:

- порт `80/tcp` должен быть доступен на время HTTP-01 проверки;
- если порт `80` занят, остановить сервис, который его занимает, или использовать DNS-01;
- сертификаты Let's Encrypt автоматически обновляются через systemd timer/cron certbot.

Проверить автообновление:

```bash
systemctl list-timers | grep certbot
certbot renew --dry-run
```

В 3x-ui/Xray обычно используются пути:

```text
/etc/letsencrypt/live/<domain>/fullchain.pem
/etc/letsencrypt/live/<domain>/privkey.pem
```

или скопированные/линкованные пути вида:

```text
/root/cert/<domain>/fullchain.pem
/root/cert/<domain>/privkey.pem
```

После смены сертификатов перезапустить 3x-ui:

```bash
systemctl restart x-ui
```

## Порты

На DE-сервере рабочая схема:

- `443/tcp` - `VLESS + XHTTP + TLS`;
- `2087/tcp` - `VLESS + XHTTP + REALITY`;
- отдельный порт панели 3x-ui;
- отдельный порт subscription server 3x-ui.

Проверить слушающие порты:

```bash
ss -lntp | egrep ':(443|2087|<panel-port>|<sub-port>)\b'
```

## Важная структура БД 3x-ui

В актуальной версии 3x-ui клиенты хранятся не только в JSON поля `inbounds.settings`.

Ключевые таблицы:

- `inbounds` - inbound'ы, настройки протокола и stream settings;
- `clients` - клиенты, их `email`, `uuid`, `sub_id`, лимиты и статусы;
- `client_inbounds` - связь клиента с inbound;
- `client_traffics` - учет трафика клиента.

Практический вывод: если добавлять клиента напрямую через SQLite/API/скрипт, нужно обновить все нужные места:

- JSON `inbounds.settings.clients`;
- строку в `clients`;
- связь в `client_inbounds`;
- строку учета в `client_traffics`.

Если добавить только JSON в `inbounds.settings`, Xray может не получить клиента в итоговом `config.json` или 3x-ui не будет считать трафик.

Проверить структуру:

```bash
sqlite3 /etc/x-ui/x-ui.db '.schema clients'
sqlite3 /etc/x-ui/x-ui.db '.schema client_inbounds'
sqlite3 /etc/x-ui/x-ui.db '.schema client_traffics'
```

Проверить, что Xray реально получил клиента:

```bash
python3 - <<'PY'
import json
p = '/usr/local/x-ui/bin/config.json'
obj = json.load(open(p))
for ib in obj.get('inbounds', []):
    if ib.get('port') in (443, 2087):
        print('---', ib.get('tag'), ib.get('port'))
        print(json.dumps(ib.get('settings', {}).get('clients'), ensure_ascii=False, indent=2))
PY
```

## Рабочий TLS inbound

Рабочая схема на `srv2.xui.mozhno.org:443`:

```text
protocol: vless
network: xhttp
security: tls
port: 443
path: /api/upload
mode: packet-up
xPaddingBytes: 100-1000
fingerprint: firefox
alpn: h2
serverName: srv2.xui.mozhno.org
```

Что оказалось полезным:

- `fingerprint=firefox` сработал лучше, чем `chrome`;
- только `alpn=h2` сработал лучше, чем `h2,http/1.1`;
- лучше создавать нового клиента с обычным ASCII `email`, без кириллических символов;
- после добавления клиента нужна строка в `client_traffics`, иначе трафик может не отображаться в панели.

Подписка для такого клиента выглядит как:

```text
https://<domain>:<sub-port>/sub/<sub_id>
```

Содержимое подписки должно отдавать `vless://...` ссылку с параметрами:

```text
type=xhttp
security=tls
mode=packet-up
path=/api/upload
fp=firefox
alpn=h2
sni=<domain>
```

## Рабочий REALITY inbound

Рабочая схема на `srv2.xui.mozhno.org:2087`:

```text
protocol: vless
network: xhttp
security: reality
port: 2087
path: /api/upload
mode: auto
xPaddingBytes: 100-1000
fingerprint: firefox
dest: www.cloudflare.com:443
serverNames: www.cloudflare.com
spiderX: /
```

Для REALITY нужны:

- private key на сервере;
- public key в клиентской ссылке;
- shortId;
- корректный SNI/serverName.

Приватный ключ нельзя хранить в документации, репозитории или отправлять пользователям. В клиентскую подписку попадает только public key.

Примечание: Xray пишет предупреждение про REALITY на не-443 портах:

```text
REALITY: Listening on non-443 ports may get your IP blocked by the GFW
```

Это предупреждение ориентировано на китайский GFW и само по себе не означает ошибку запуска.

## Проверка подключений через российский сервер

Для точной диагностики использовать `ssh tgproxy2ru`, а не локальную машину, если на локальной машине включен VPN.

Проверка через временный Xray client:

```bash
ssh tgproxy2ru

cat >/tmp/xray-test.json <<'JSON'
{
  "log": {"loglevel": "warning", "access": "none", "error": "/tmp/xray-test.err"},
  "inbounds": [
    {
      "tag": "socks",
      "listen": "127.0.0.1",
      "port": 10991,
      "protocol": "socks",
      "settings": {"udp": true}
    }
  ],
  "outbounds": [
    {
      "tag": "proxy",
      "protocol": "vless",
      "settings": {
        "vnext": [
          {
            "address": "<domain>",
            "port": 443,
            "users": [
              {
                "id": "<client-uuid>",
                "encryption": "none",
                "security": "auto"
              }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "xhttp",
        "security": "tls",
        "xhttpSettings": {
          "path": "/api/upload",
          "mode": "packet-up",
          "xPaddingBytes": "100-1000"
        },
        "tlsSettings": {
          "serverName": "<domain>",
          "fingerprint": "firefox",
          "alpn": ["h2"]
        }
      }
    }
  ]
}
JSON

xray run -config /tmp/xray-test.json
```

В другом SSH-окне на `tgproxy2ru`:

```bash
curl -sS --max-time 15 --socks5-hostname 127.0.0.1:10991 https://api.ipify.org
curl -sS --max-time 15 --socks5-hostname 127.0.0.1:10991 https://1.1.1.1/cdn-cgi/trace
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 --socks5-hostname 127.0.0.1:10991 https://ya.ru
```

Успешные признаки:

- `api.ipify.org` возвращает IP Xray-сервера;
- `cdn-cgi/trace` показывает нужную страну/IP;
- для TLS/XHTTP обычно видно `http=http/2` и `tls=TLSv1.3`;
- сайты отдают HTTP `200`, `204`, `301` или `302`, а не timeout.

## Проверка подписки

```bash
python3 - <<'PY'
import urllib.request, base64

url = 'https://<domain>:<sub-port>/sub/<sub_id>'
data = urllib.request.urlopen(url, timeout=10).read().strip()
raw = base64.b64decode(data + b'=' * ((4 - len(data) % 4) % 4)).decode('utf-8', 'replace')

for line in raw.splitlines():
    if line.strip():
        print(line.split(':', 1)[0], 'xhttp=', 'type=xhttp' in line, 'tls=', 'security=tls' in line, 'reality=', 'security=reality' in line)
PY
```

Не печатать полные ссылки в публичные логи: в них есть UUID/ключи доступа.

## Проверка логов и счетчиков

Логи:

```bash
journalctl -u x-ui --since '10 minutes ago' --no-pager | tail -200
```

Активные соединения:

```bash
ss -antp '( sport = :443 or sport = :2087 )'
```

Счетчики клиентов:

```bash
python3 - <<'PY'
import sqlite3, datetime

con = sqlite3.connect('/etc/x-ui/x-ui.db')
con.row_factory = sqlite3.Row

def fmt(v):
    v = float(v or 0)
    units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    i = 0
    while v >= 1024 and i < len(units) - 1:
        v /= 1024
        i += 1
    return f'{v:.2f} {units[i]}' if i else f'{int(v)} B'

for r in con.execute('select inbound_id,email,up,down,last_online from client_traffics order by inbound_id,email'):
    ms = int(r['last_online'] or 0)
    last = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat() if ms else None
    print(r['inbound_id'], r['email'], 'up', fmt(r['up']), 'down', fmt(r['down']), 'last', last)
PY
```

Если туннель работает, но счетчик не растет:

- проверить наличие клиента в `/usr/local/x-ui/bin/config.json`;
- проверить строку в `client_traffics`;
- выполнить более заметную загрузку, например 1 МБ через SOCKS;
- подождать 10-20 секунд, 3x-ui обновляет статистику не мгновенно.

## Типовые проблемы

### Локально работает, у пользователя нет

Причина может быть в том, что локальная машина сама работает через VPN. Проверять надо из сети, похожей на пользовательскую, или с российского контрольного сервера.

### После подключения пинг до сервера пропадает

Это может быть нормальным, если клиент заворачивает весь трафик в туннель и маршрут до самого VPN-сервера тоже уходит внутрь туннеля. Надо проверять не ICMP до сервера, а доступ наружу через туннель:

```text
https://1.1.1.1/cdn-cgi/trace
https://api.ipify.org
```

### TLS handshake error

Проверить:

- совпадает ли `serverName`/SNI с сертификатом;
- верный ли порт;
- верный ли `path`;
- совпадает ли `security=tls`;
- не проксируется ли DNS-запись Cloudflare orange cloud;
- не выбран ли неподдерживаемый клиентом fingerprint/ALPN.

### Клиент импортируется, но интернета нет

Проверить:

- режим клиента: Global/Proxy all;
- DNS внутри клиента;
- full tunnel/route mode;
- что клиент реально использует новый профиль, а не старый;
- счетчики на сервере растут ли во время попытки.

## Что не хранить в документах

Не фиксировать в репозитории:

- логины/пароли панелей;
- Cloudflare API token;
- UUID реальных клиентов, если документ может уйти наружу;
- private key REALITY;
- полные subscription links с рабочими клиентскими UUID;
- backup базы `/etc/x-ui/x-ui.db`.

Для операционных заметок можно указывать домены, порты, типы inbound'ов, безопасные шаблоны команд и выводы диагностики.
