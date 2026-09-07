from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import qrcode
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Не задана обязательная переменная {name}")
    return value


async def authorize() -> None:
    api_id = int(required_env("TELEGRAM_API_ID"))
    api_hash = required_env("TELEGRAM_API_HASH")
    session_path = Path(os.getenv("TELEGRAM_AUTH_SESSION_PATH", "/session/telegram"))
    qr_path = Path(os.getenv("TELEGRAM_AUTH_QR_PATH", "/session/telegram-login-qr.png"))
    password = os.getenv("TELEGRAM_PASSWORD", "")
    session_path.parent.mkdir(parents=True, exist_ok=True)

    client = TelegramClient(str(session_path), api_id, api_hash)
    await client.connect()
    try:
        if await client.is_user_authorized():
            print("Telegram-сессия уже авторизована", flush=True)
            return

        qr_login = await client.qr_login()
        qrcode.make(qr_login.url).save(qr_path)
        print(f"QR_READY {qr_path}", flush=True)
        print(
            "Откройте Telegram: Настройки -> Устройства -> Подключить устройство и отсканируйте QR",
            flush=True,
        )
        try:
            await qr_login.wait(timeout=180)
        except SessionPasswordNeededError:
            if not password:
                raise RuntimeError(
                    "После QR требуется облачный пароль, но TELEGRAM_PASSWORD не задан"
                )
            await client.sign_in(password=password)

        if not await client.is_user_authorized():
            raise RuntimeError("Telegram не подтвердил авторизацию")
        print("AUTH_OK", flush=True)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(authorize())
    except Exception as error:
        print(f"Ошибка авторизации: {error}", file=sys.stderr)
        raise
