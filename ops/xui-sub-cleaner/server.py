#!/usr/bin/env python3
import base64
import http.server
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

SUB_RE = re.compile(r"^/sub/([A-Za-z0-9._~-]+)$")
SSL_CONTEXT = ssl._create_unverified_context()
DEFAULT_CONFIG_PATH = "/etc/xui-sub-cleaner/config.json"
JSON_USER_AGENT_RE = re.compile(r"(v2box|incy)", re.IGNORECASE)
PROXY_SCHEMES = {"vless", "vmess", "trojan", "ss", "hysteria", "hysteria2"}
DEFAULT_DIRECT_DOMAINS = [
    "regexp:.*\\.ru$",
    "regexp:.*\\.su$",
    "regexp:.*\\.xn--p1ai$",
    "domain:ozon.app",
    "domain:ozon.ru",
    "domain:ozonusercontent.com",
    "domain:wildberries.ru",
    "domain:wb.ru",
    "domain:yandex.net",
    "domain:yastatic.net",
    "domain:yandex.com",
    "domain:yandex.ru",
    "domain:vk.com",
    "domain:vk-cdn.net",
    "domain:userapi.com",
    "domain:vkuservideo.net",
    "domain:mycdn.me",
    "domain:mradx.net",
    "domain:avito.ru",
    "domain:avito.st",
    "domain:2gis.com",
    "domain:2gis.ru",
    "domain:gismeteo.net",
    "domain:gismeteo.ru",
]
PRIVATE_IP_RANGES = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "100.64.0.0/10",
    "169.254.0.0/16",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
]


class ConfigError(Exception):
    pass


def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as file:
        raw = json.load(file)

    listen = raw.get("listen", {})
    upstream = raw.get("upstream", {})
    public = raw.get("public", {})
    json_config = raw.get("json", {})
    nodes = raw.get("nodes", [])

    config = {
        "host": listen.get("host", "127.0.0.1"),
        "port": int(listen.get("port", 18080)),
        "upstream_url": upstream.get("url", "https://127.0.0.1:2096"),
        "upstream_host_header": upstream.get("hostHeader", public.get("host", "")),
        "profile_title": public.get("profileTitle", "МОЖНО ВПН"),
        "support_url": public.get("supportUrl", "https://t.me/"),
        "file_name": public.get("fileName", "mozhno-vpn.txt"),
        "file_name_utf8": public.get("fileNameUtf8", "МОЖНО ВПН.txt"),
        "profile_update_interval": str(public.get("profileUpdateInterval", "12")),
        "json_user_agent_re": re.compile(json_config.get("userAgentPattern", JSON_USER_AGENT_RE.pattern), re.IGNORECASE),
        "json_direct_domains": json_config.get("directDomains", DEFAULT_DIRECT_DOMAINS),
        "json_private_ips": json_config.get("privateIps", PRIVATE_IP_RANGES),
        "json_ru_dns": json_config.get("ruDns", "77.88.8.8"),
        "json_remote_dns": json_config.get("remoteDns", "https://1.1.1.1/dns-query"),
        "json_block_udp_443": bool(json_config.get("blockUdp443", True)),
        "name_by_hostport": {},
        "name_by_host": {},
    }

    if not config["upstream_url"]:
        raise ConfigError("upstream.url is required")

    for node in nodes:
        name = node.get("name")
        if not name:
            raise ConfigError("nodes[].name is required")
        for hostport in node.get("hostports", []):
            config["name_by_hostport"][hostport.lower()] = name
        for host in node.get("hosts", []):
            config["name_by_host"][host.lower()] = name

    return config


CONFIG_PATH = os.environ.get("XUI_SUB_CLEANER_CONFIG", DEFAULT_CONFIG_PATH)
CONFIG = load_config(CONFIG_PATH)


def decode_subscription(payload: bytes) -> str:
    raw = payload.strip()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = ""
    if "vless://" in text or "vmess://" in text or "trojan://" in text:
        return text
    compact = re.sub(rb"\s+", b"", raw)
    compact += b"=" * ((4 - len(compact) % 4) % 4)
    return base64.b64decode(compact).decode("utf-8", "replace")


def is_proxy_link(value: str) -> bool:
    try:
        return urllib.parse.urlsplit(value).scheme in PROXY_SCHEMES
    except ValueError:
        return False


def display_name_for(line: str) -> str | None:
    try:
        parts = urllib.parse.urlsplit(line)
    except ValueError:
        return None
    if parts.scheme not in PROXY_SCHEMES:
        return None
    hostport = parts.netloc.rsplit("@", 1)[-1].lower()
    host = hostport.rsplit(":", 1)[0]
    return CONFIG["name_by_hostport"].get(hostport) or CONFIG["name_by_host"].get(host)


def rewrite_line(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return stripped
    name = display_name_for(stripped)
    if not name:
        return stripped
    parts = urllib.parse.urlsplit(stripped)
    return urllib.parse.urlunsplit((
        parts.scheme,
        parts.netloc,
        parts.path,
        parts.query,
        urllib.parse.quote(name, safe=""),
    ))


def should_render_json(user_agent: str) -> bool:
    return bool(CONFIG["json_user_agent_re"].search(user_agent or ""))


def parsed_query(parts: urllib.parse.SplitResult) -> dict:
    return {
        key: values[-1] if values else ""
        for key, values in urllib.parse.parse_qs(parts.query, keep_blank_values=True).items()
    }


def split_alpn(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def outbound_from_uri(line: str) -> dict | None:
    parts = urllib.parse.urlsplit(line)
    query = parsed_query(parts)
    host = parts.hostname
    port = parts.port
    if not host or not port:
        return None

    if parts.scheme == "vless":
        user = {
            "id": parts.username or "",
            "encryption": query.get("encryption", "none"),
        }
        if query.get("flow"):
            user["flow"] = query["flow"]

        outbound = {
            "tag": "proxy",
            "protocol": "vless",
            "settings": {
                "vnext": [
                    {
                        "address": host,
                        "port": port,
                        "users": [user],
                    }
                ]
            },
        }
    elif parts.scheme == "trojan":
        outbound = {
            "tag": "proxy",
            "protocol": "trojan",
            "settings": {
                "servers": [
                    {
                        "address": host,
                        "port": port,
                        "password": urllib.parse.unquote(parts.username or ""),
                    }
                ]
            },
        }
    else:
        return None

    stream = {}
    network = query.get("type") or "tcp"
    stream["network"] = network
    security = query.get("security")
    if security:
        stream["security"] = security

    if security == "tls":
        tls_settings = {}
        if query.get("sni"):
            tls_settings["serverName"] = query["sni"]
        if query.get("fp"):
            tls_settings["fingerprint"] = query["fp"]
        if query.get("alpn"):
            tls_settings["alpn"] = split_alpn(query["alpn"])
        if tls_settings:
            stream["tlsSettings"] = tls_settings
    elif security == "reality":
        reality_settings = {}
        if query.get("sni"):
            reality_settings["serverName"] = query["sni"]
        if query.get("fp"):
            reality_settings["fingerprint"] = query["fp"]
        if query.get("pbk"):
            reality_settings["publicKey"] = query["pbk"]
        if query.get("sid"):
            reality_settings["shortId"] = query["sid"]
        if query.get("spx"):
            reality_settings["spiderX"] = query["spx"]
        if reality_settings:
            stream["realitySettings"] = reality_settings

    if network == "xhttp":
        xhttp_settings = {
            "path": query.get("path", "/"),
            "mode": query.get("mode", "auto"),
        }
        headers = {"Pragma": "no-cache"}
        if query.get("host"):
            headers["Host"] = query["host"]
        xhttp_settings["headers"] = headers
        stream["xhttpSettings"] = xhttp_settings
    elif network == "tcp":
        stream["tcpSettings"] = {"header": {"type": "none"}}

    outbound["streamSettings"] = stream
    return outbound


def routing_rules() -> list[dict]:
    rules = [
        {"type": "field", "port": "53", "outboundTag": "dns-out"},
        {"type": "field", "ip": CONFIG["json_private_ips"], "outboundTag": "direct"},
    ]
    if CONFIG["json_block_udp_443"]:
        rules.append({"type": "field", "network": "udp", "port": "443", "outboundTag": "block"})
    rules.extend([
        {"type": "field", "domain": CONFIG["json_direct_domains"], "outboundTag": "direct"},
        {"type": "field", "port": "0-65535", "outboundTag": "proxy"},
    ])
    return rules


def v2ray_json_config(line: str) -> dict | None:
    proxy = outbound_from_uri(line)
    if not proxy:
        return None

    remarks = display_name_for(line) or urllib.parse.unquote(urllib.parse.urlsplit(line).fragment) or "MOZHNO VPN"
    return {
        "log": {"access": "", "error": "", "loglevel": "warning"},
        "inbounds": [
            {"tag": "socks", "port": 10808, "listen": "127.0.0.1", "protocol": "socks", "settings": {"udp": True}},
            {"tag": "http", "port": 10809, "listen": "127.0.0.1", "protocol": "http", "settings": {}},
        ],
        "outbounds": [
            proxy,
            {"tag": "direct", "protocol": "freedom", "settings": {}},
            {"tag": "block", "protocol": "blackhole", "settings": {}},
            {"tag": "dns-out", "protocol": "dns", "settings": {}},
        ],
        "dns": {
            "queryStrategy": "UseIPv4",
            "servers": [
                {"address": CONFIG["json_ru_dns"], "domains": CONFIG["json_direct_domains"]},
                {"address": CONFIG["json_remote_dns"], "detour": "proxy"},
            ],
        },
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": routing_rules(),
        },
        "remarks": remarks,
    }


def render_v2ray_json(lines: list[str]) -> bytes:
    configs = []
    seen = set()
    for line in lines:
        rewritten = rewrite_line(line)
        if rewritten in seen:
            continue
        seen.add(rewritten)
        item = v2ray_json_config(rewritten)
        if item:
            configs.append(item)
    return json.dumps(configs, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def render_uri_subscription(lines: list[str]) -> bytes:
    rewritten = "\n".join(rewrite_line(line) for line in lines) + "\n"
    return base64.b64encode(rewritten.encode("utf-8"))


def send_subscription_headers(handler: http.server.BaseHTTPRequestHandler, body: bytes, content_type: str, upstream_headers) -> None:
    title = base64.b64encode(CONFIG["profile_title"].encode("utf-8")).decode("ascii")
    encoded_file_name = urllib.parse.quote(CONFIG["file_name_utf8"])
    handler.send_header("Content-Type", content_type)
    handler.send_header("Profile-Title", f"base64:{title}")
    if CONFIG["support_url"]:
        handler.send_header("Support-Url", CONFIG["support_url"])
    handler.send_header("Profile-Update-Interval", CONFIG["profile_update_interval"])
    if "Subscription-Userinfo" in upstream_headers:
        handler.send_header("Subscription-Userinfo", upstream_headers["Subscription-Userinfo"])
    handler.send_header(
        "Content-Disposition",
        f'attachment; filename="{CONFIG["file_name"]}"; filename*=UTF-8\'\'{encoded_file_name}',
    )
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "xui-sub-cleaner/1.0"

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if not SUB_RE.match(parsed.path):
            self.send_response(404)
            self.end_headers()
            return

        upstream_url = CONFIG["upstream_url"].rstrip("/") + parsed.path
        headers = {
            "User-Agent": self.headers.get("User-Agent", "xui-sub-cleaner"),
        }
        if CONFIG["upstream_host_header"]:
            headers["Host"] = CONFIG["upstream_host_header"]
        req = urllib.request.Request(upstream_url, headers=headers)
        try:
            with urllib.request.urlopen(req, context=SSL_CONTEXT, timeout=15) as resp:
                payload = resp.read()
                status = resp.status
                upstream_headers = resp.headers
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            upstream_headers = exc.headers
        except Exception as exc:
            body = f"upstream error: {exc}\n".encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if status != 200:
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        decoded = decode_subscription(payload)
        lines = [line.strip() for line in decoded.splitlines() if is_proxy_link(line.strip())]
        if should_render_json(self.headers.get("User-Agent", "")):
            body = render_v2ray_json(lines)
            content_type = "application/json"
        else:
            body = render_uri_subscription(lines)
            content_type = "text/plain; charset=utf-8"

        self.send_response(200)
        send_subscription_headers(self, body, content_type, upstream_headers)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    httpd = http.server.ThreadingHTTPServer((CONFIG["host"], CONFIG["port"]), Handler)
    httpd.serve_forever()
