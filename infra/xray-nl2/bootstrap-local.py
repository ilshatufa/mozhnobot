#!/usr/bin/env python3
"""Prepare a fresh 3X-UI database locally; keep credentials outside Git."""

import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid

IMAGE = "ghcr.io/mhsanaei/3x-ui:v3.7.0"
HOST = "srv2.amneziya.mozhno.org"
CERT = "/cert/" + HOST


def docker(*args):
    result = subprocess.run(["docker", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Docker command failed; inspect the private bootstrap log")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    db_dir = root / "db"
    db_dir.mkdir(mode=0o700)
    cert_dir = root / "test-cert"
    cert_dir.mkdir(mode=0o700)
    docker("run", "--rm", "--network", "none", "-v", str(cert_dir) + ":/cert",
           "--entrypoint", "openssl", IMAGE, "req", "-x509", "-newkey", "rsa:2048",
           "-nodes", "-days", "1", "-subj", "/CN=" + HOST,
           "-keyout", CERT + ".key", "-out", CERT + ".crt")
    credentials = {
        "username": "nl2_" + secrets.token_hex(8),
        "password": secrets.token_urlsafe(36),
        "base_path": "/" + secrets.token_urlsafe(24) + "/",
        "diagnostic_client_id": str(uuid.uuid4()),
        "diagnostic_sub_id": secrets.token_urlsafe(18),
    }
    secret_file = root / "credentials.json"
    secret_file.write_text(json.dumps(credentials, indent=2))
    os.chmod(secret_file, 0o600)
    common = ["--rm", "--network", "none", "-v", str(db_dir) + ":/etc/x-ui",
              "-v", str(cert_dir) + ":/cert:ro", "--entrypoint", "/app/x-ui", IMAGE]
    docker("run", *common, "setting", "-username", credentials["username"],
           "-password", credentials["password"], "-port", "2053",
           "-listenIP", "0.0.0.0", "-webBasePath", credentials["base_path"])
    name = "nl2-bootstrap-" + str(os.getpid())
    try:
        docker("run", "-d", "--name", name, "--cap-drop", "ALL",
               "--security-opt", "no-new-privileges:true", "--memory", "512m",
               "--cpus", "0.75", "-e", "XUI_ENABLE_FAIL2BAN=false",
               "-v", str(db_dir) + ":/etc/x-ui", "-v", str(cert_dir) + ":/cert:ro",
               "-p", "127.0.0.1:19183:2053", IMAGE)
        base = "http://127.0.0.1:19183" + credentials["base_path"].rstrip("/")
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        html = None
        for _ in range(80):
            try:
                html = opener.open(base + "/", timeout=1).read().decode()
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        if html is None:
            raise RuntimeError("Local panel did not become ready")
        token = re.search(r'name="csrf-token"\s+content="([^"]+)"', html)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-CSRF-Token"] = token.group(1)

        def request(path, data=None):
            body = None if data is None else json.dumps(data).encode()
            req = urllib.request.Request(base + path, data=body, headers=headers)
            with opener.open(req, timeout=10) as response:
                result = json.loads(response.read())
            if result.get("success") is False:
                raise RuntimeError("3X-UI rejected " + path + ": " + str(result.get("msg")))
            return result

        request("/login", {"username": credentials["username"], "password": credentials["password"]})
        inbound = {
            "enable": True,
            "remark": "🇳🇱 МОЖНО • Нидерланды 2",
            "listen": "",
            "port": 11443,
            "protocol": "vless",
            "expiryTime": 0,
            "settings": json.dumps({"clients": [{
                "id": credentials["diagnostic_client_id"],
                "email": "nl2-deployment-diagnostic",
                "enable": True,
                "expiryTime": int(time.time() * 1000) + 3600000,
                "totalGB": 0,
                "subId": credentials["diagnostic_sub_id"],
                "flow": "",
            }], "decryption": "none", "fallbacks": []}),
            "streamSettings": json.dumps({
                "network": "xhttp", "security": "tls",
                "tlsSettings": {"serverName": HOST, "minVersion": "1.2", "alpn": ["h2"],
                                "certificates": [{"certificateFile": CERT + ".crt", "keyFile": CERT + ".key", "oneTimeLoading": False}]},
                "xhttpSettings": {"path": "/api/upload", "mode": "packet-up"},
            }),
            "sniffing": json.dumps({"enabled": True, "destOverride": ["http", "tls", "quic"]}),
        }
        result = request("/panel/api/inbounds/add", inbound)
        listed = request("/panel/api/inbounds/list")["obj"]
        if len(listed) != 1 or listed[0]["id"] != 1 or listed[0]["port"] != 11443:
            raise RuntimeError("Unexpected inbound identity")
        (root / "inbound.json").write_text(json.dumps(inbound, ensure_ascii=False, indent=2))
        os.chmod(root / "inbound.json", 0o600)
        # Read the actual settings schema before setting the subscription listener.
        settings = request("/panel/api/setting/all", {})["obj"]
        settings.update({"subEnable": True, "subListen": "0.0.0.0", "subPort": 2096,
                         "subURI": "https://" + HOST + ":2096/sub/", "subDomain": HOST,
                         "subCertFile": CERT + ".crt",
                         "subKeyFile": CERT + ".key"})
        request("/panel/api/setting/update", settings)
    finally:
        subprocess.run(["docker", "stop", "--time", "2", name], capture_output=True)
        subprocess.run(["docker", "rm", name], capture_output=True)
    docker("run", *common, "setting", "-webCert", CERT + ".crt", "-webCertKey", CERT + ".key")
    # Collapse WAL into a portable, clean SQLite file after the panel stopped.
    database = db_dir / "x-ui.db"
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    os.chmod(database, 0o600)
    print(json.dumps({"database": str(database), "inbound_id": 1, "vpn_port": 11443,
                      "panel_port": 2053, "subscription_port": 2096,
                      "credentials_file": str(secret_file)}))


if __name__ == "__main__":
    main()
