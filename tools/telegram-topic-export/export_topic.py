from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient, functions
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Не задана обязательная переменная {name}")
    return value


def json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def safe_name(value: str) -> str:
    normalized = "".join(
        char.lower() if char.isalnum() else "_" for char in value.strip()
    )
    return "_".join(part for part in normalized.split("_") if part) or "topic"


def sender_name(sender: Any) -> str:
    if sender is None:
        return ""
    title = getattr(sender, "title", None)
    if title:
        return title
    parts = [getattr(sender, "first_name", None), getattr(sender, "last_name", None)]
    return " ".join(part for part in parts if part)


def media_kind(message: Any) -> str:
    media = getattr(message, "media", None)
    if media is None:
        return ""
    if isinstance(media, MessageMediaPhoto):
        return "photo"
    if isinstance(media, MessageMediaDocument):
        mime_type = getattr(getattr(media, "document", None), "mime_type", "") or ""
        return mime_type or "document"
    return type(media).__name__


def should_download(message: Any, mode: str) -> bool:
    if mode == "none" or not getattr(message, "media", None):
        return False
    if mode == "all":
        return True
    if isinstance(message.media, MessageMediaPhoto):
        return True
    if isinstance(message.media, MessageMediaDocument):
        mime_type = getattr(getattr(message.media, "document", None), "mime_type", "") or ""
        return mime_type.startswith("image/")
    return False


async def export_topic() -> None:
    api_id = int(required_env("TELEGRAM_API_ID"))
    api_hash = required_env("TELEGRAM_API_HASH")
    chat_id = int(required_env("TELEGRAM_CHAT_ID"))
    topic_id = int(required_env("TELEGRAM_TOPIC_ID"))
    source_session = Path(required_env("TELEGRAM_SESSION_PATH"))
    export_root = Path(required_env("TELEGRAM_EXPORT_ROOT"))
    download_mode = os.getenv("TELEGRAM_DOWNLOAD_MEDIA", "images").strip().lower()
    if download_mode not in {"none", "images", "all"}:
        raise RuntimeError("TELEGRAM_DOWNLOAD_MEDIA должен быть none, images или all")
    if not source_session.is_file():
        raise RuntimeError(f"Файл Telegram-сессии не найден: {source_session}")

    session_dir = Path("/tmp/telegram-session")
    session_dir.mkdir(parents=True, exist_ok=True)
    working_session = session_dir / "telegram.session"
    shutil.copy2(source_session, working_session)

    client = TelegramClient(str(working_session.with_suffix("")), api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError(
                "Сохраненная Telegram-сессия больше не авторизована; требуется интерактивное обновление сессии"
            )

        entity = await client.get_entity(chat_id)
        topics = await client(
            functions.messages.GetForumTopicsByIDRequest(
                peer=entity,
                topics=[topic_id],
            )
        )
        if not topics.topics:
            raise RuntimeError(f"Подтема {topic_id} не найдена в чате {chat_id}")
        topic = topics.topics[0]
        topic_title = topic.title

        export_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        export_dir = export_root / f"topic_{topic_id}_{safe_name(topic_title)}_{export_stamp}"
        media_dir = export_dir / "media"
        export_dir.mkdir(parents=True, exist_ok=False)
        if download_mode != "none":
            media_dir.mkdir()

        records: list[dict[str, Any]] = []
        async for message in client.iter_messages(entity, reply_to=topic_id, reverse=True):
            sender = message.sender
            if sender is None and message.sender_id is not None:
                sender = await message.get_sender()

            downloaded_media = ""
            if should_download(message, download_mode):
                downloaded = await client.download_media(
                    message,
                    file=str(media_dir / f"message_{message.id}"),
                )
                if downloaded:
                    downloaded_media = str(Path(downloaded).relative_to(export_dir))

            reply = getattr(message, "reply_to", None)
            record = {
                "id": message.id,
                "date": message.date.isoformat() if message.date else "",
                "sender_id": message.sender_id,
                "sender_username": getattr(sender, "username", None),
                "sender_name": sender_name(sender),
                "topic_id": topic_id,
                "topic_title": topic_title,
                "reply_to": getattr(reply, "reply_to_msg_id", None),
                "reply_to_top_id": getattr(reply, "reply_to_top_id", None),
                "message_type": type(message.action).__name__ if message.action else "text",
                "text": message.message or "",
                "text_length": len(message.message or ""),
                "media_type": media_kind(message),
                "media_path": downloaded_media,
                "edit_date": message.edit_date.isoformat() if message.edit_date else "",
            }
            records.append(record)

        if not records:
            raise RuntimeError(f"В подтеме {topic_id} не найдено сообщений")

        ids = [record["id"] for record in records]
        duplicate_ids = [message_id for message_id, count in Counter(ids).items() if count > 1]
        if duplicate_ids:
            raise RuntimeError(f"В экспорте обнаружены дубли ID: {duplicate_ids}")

        messages_path = export_dir / "messages.jsonl"
        with messages_path.open("w", encoding="utf-8") as output:
            for record in records:
                output.write(json.dumps(record, ensure_ascii=False, default=json_value) + "\n")

        markdown_path = export_dir / f"topic_{topic_id}_{safe_name(topic_title)}.md"
        with markdown_path.open("w", encoding="utf-8") as output:
            output.write(f"# {topic_title}\n\n")
            output.write(f"Topic ID: `{topic_id}`  \n")
            output.write(f"Сообщений: {len(records)}  \n")
            output.write(f"Дата экспорта: {datetime.now(timezone.utc).isoformat()}\n\n")
            for record in records:
                author = record["sender_name"] or str(record["sender_id"] or "неизвестный автор")
                if record["sender_username"]:
                    author += f" (@{record['sender_username']})"
                details = [f"reply_to={record['reply_to']}"] if record["reply_to"] else []
                if record["media_type"]:
                    details.append(f"media={record['media_type']}")
                suffix = f" {' '.join(details)}" if details else ""
                output.write(
                    f"### {record['date']} | msg {record['id']} | {author}{suffix}\n\n"
                )
                output.write((record["text"] or "[no text]") + "\n")
                if record["media_path"]:
                    output.write(f"\nМедиа: `{record['media_path']}`\n")
                output.write("\n")

        participants = Counter(
            record["sender_username"] or record["sender_name"] or str(record["sender_id"])
            for record in records
        )
        summary = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "chat_id": chat_id,
            "chat_title": getattr(entity, "title", ""),
            "topic_id": topic_id,
            "topic_title": topic_title,
            "messages_count": len(records),
            "text_messages_count": sum(bool(record["text"]) for record in records),
            "media_messages_count": sum(bool(record["media_type"]) for record in records),
            "downloaded_media_count": sum(bool(record["media_path"]) for record in records),
            "first_message_id": records[0]["id"],
            "first_message_date": records[0]["date"],
            "last_message_id": records[-1]["id"],
            "last_message_date": records[-1]["date"],
            "unique_message_ids": len(set(ids)),
            "participants_count": len(participants),
            "top_participants": participants.most_common(20),
            "download_media_mode": download_mode,
        }
        (export_dir / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        print(json.dumps({"export_dir": str(export_dir), **summary}, ensure_ascii=False, indent=2))
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(export_topic())
    except Exception as error:
        print(f"Ошибка экспорта: {error}", file=sys.stderr)
        raise
