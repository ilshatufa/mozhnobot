# xui-sub-cleaner

Small local wrapper for `xui.mozhno.org` subscriptions.

It sits between nginx and the 3X-UI subscription server:

```text
client -> nginx :443 -> xui-sub-cleaner :18080 -> 3X-UI sub :2096
```

What it changes:

- adds subscription title `МОЖНО ВПН` via `Profile-Title`;
- adds `Support-Url`, `Profile-Update-Interval` and passes through `Subscription-Userinfo` from 3X-UI when present;
- rewrites node names to `MOZHNO RU`, `MOZHNO DE`, `MOZHNO LV`;
- returns V2Ray JSON configs for `V2Box`/`Incy` user agents;
- adds JSON routing rules for private IP direct, RU-domain direct, UDP/443 block, and proxy as final route;
- adds split DNS for JSON configs: RU domains via `77.88.8.8`, remote DNS via proxy;
- keeps UUIDs, ports, limits and protocol settings unchanged.

## Deploy on `3xuiru`

```bash
install -d /opt/xui-sub-cleaner
install -d /etc/xui-sub-cleaner
install -m 0755 server.py /opt/xui-sub-cleaner/server.py
install -m 0644 config.example.json /etc/xui-sub-cleaner/config.json
install -m 0644 xui-sub-cleaner.service /etc/systemd/system/xui-sub-cleaner.service
install -m 0644 nginx-xui-subscription.conf /etc/nginx/sites-available/xui-subscription.conf
ln -sf /etc/nginx/sites-available/xui-subscription.conf /etc/nginx/sites-enabled/xui-subscription.conf
python3 -m py_compile /opt/xui-sub-cleaner/server.py
nginx -t
systemctl daemon-reload
systemctl enable --now xui-sub-cleaner
systemctl reload nginx
```

## Verify

```bash
curl -skD - -o /tmp/xui-sub.txt https://xui.mozhno.org/sub/<sub-id> \
  | grep -i 'profile-title'
base64 -d /tmp/xui-sub.txt
```

## Config

Runtime settings live in `/etc/xui-sub-cleaner/config.json`.

Use it to change:

- public subscription title;
- support URL;
- JSON user-agent detection;
- direct RU domain list and DNS servers;
- downloaded file name;
- upstream 3X-UI subscription URL;
- node display names and matching hosts/host:port pairs.
