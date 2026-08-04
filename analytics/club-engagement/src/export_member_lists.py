from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ANALYSIS_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ANALYSIS_ROOT / "data" / "raw" / "member_lists_snapshot.json"
OUTPUT_DIR = ANALYSIS_ROOT / "outputs" / "private"
LOCAL_TZ = ZoneInfo("Asia/Yekaterinburg")
CURRENT_STATUSES = {"member", "administrator", "creator"}
ACTIVITY_LABELS = {
    "message_created": "сообщение",
    "message_edited": "редактирование сообщения",
    "reaction_changed": "реакция",
    "callback_clicked": "нажатие кнопки",
}


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def format_datetime(value: str | None) -> str:
    parsed = parse_datetime(value)
    if not parsed:
        return ""
    return parsed.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


def escape_markdown(value: object | None) -> str:
    if value is None:
        return ""
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def display_name(user: dict) -> str:
    return " ".join(
        part for part in [user.get("first_name"), user.get("last_name")] if part
    ).strip()


def is_current_member(user: dict) -> bool:
    status = user.get("telegram_status")
    return status in CURRENT_STATUSES or (
        status == "restricted" and user.get("telegram_is_member") is True
    )


def render_current_members(snapshot: dict, users: list[dict]) -> str:
    current = [user for user in users if not user.get("is_bot") and is_current_member(user)]
    current.sort(
        key=lambda user: parse_datetime(user.get("last_activity_at"))
        or datetime(1970, 1, 1, tzinfo=LOCAL_TZ),
        reverse=True,
    )
    without_activity = sum(not user.get("last_activity_at") for user in current)

    lines = [
        "# Текущие участники клуба по последней активности",
        "",
        f"Срез: {format_datetime(snapshot['snapshot_at'])} YEKT.",
        "",
        f"Всего людей: **{len(current)}**. Без зафиксированной активности: **{without_activity}**.",
        "",
        "Последняя активность — последнее сохранённое сообщение, редактирование, реакция или нажатие кнопки в клубной группе. Пассивное чтение Telegram не фиксируется.",
        "",
        "| № | Участник | Username | Telegram ID | Последняя активность | Действие |",
        "|---:|---|---|---:|---|---|",
    ]
    for index, user in enumerate(current, start=1):
        username = f"@{user['username']}" if user.get("username") else ""
        activity = format_datetime(user.get("last_activity_at"))
        activity_type = ACTIVITY_LABELS.get(user.get("last_activity_type"), "")
        lines.append(
            "| {index} | {name} | {username} | {telegram_id} | {activity} | {activity_type} |".format(
                index=index,
                name=escape_markdown(display_name(user)),
                username=escape_markdown(username),
                telegram_id=escape_markdown(user["telegram_id"]),
                activity=activity,
                activity_type=activity_type,
            )
        )
    return "\n".join(lines) + "\n"


def render_left_members(snapshot: dict, users: list[dict]) -> str:
    non_current = [
        user for user in users if not user.get("is_bot") and not is_current_member(user)
    ]
    dated = [
        user
        for user in non_current
        if user.get("latest_membership_event") == "member_left"
        and user.get("latest_membership_event_at")
    ]
    dated.sort(
        key=lambda user: parse_datetime(user["latest_membership_event_at"]), reverse=True
    )
    dated_ids = {user["telegram_id"] for user in dated}
    undated = [
        user
        for user in non_current
        if user.get("telegram_status") == "left" and user["telegram_id"] not in dated_ids
    ]
    undated.sort(
        key=lambda user: parse_datetime(user.get("last_activity_at"))
        or datetime(1970, 1, 1, tzinfo=LOCAL_TZ),
        reverse=True,
    )

    lines = [
        "# Ушедшие из клуба по дате выхода",
        "",
        f"Срез: {format_datetime(snapshot['snapshot_at'])} YEKT.",
        "",
        f"С сохранённой датой выхода: **{len(dated)}**. Статус выхода подтверждён, но дата не сохранилась: **{len(undated)}**.",
        "",
        "Удалённые администратором в этот список не включены. История событий выхода сохраняется с 4 июня 2026 года.",
        "",
        "## С известной датой выхода",
        "",
        "| № | Участник | Username | Telegram ID | Дата выхода | Последняя активность |",
        "|---:|---|---|---:|---|---|",
    ]
    for index, user in enumerate(dated, start=1):
        username = f"@{user['username']}" if user.get("username") else ""
        lines.append(
            "| {index} | {name} | {username} | {telegram_id} | {left_at} | {activity} |".format(
                index=index,
                name=escape_markdown(display_name(user)),
                username=escape_markdown(username),
                telegram_id=escape_markdown(user["telegram_id"]),
                left_at=format_datetime(user.get("latest_membership_event_at")),
                activity=format_datetime(user.get("last_activity_at")),
            )
        )

    lines.extend(
        [
            "",
            "## Дата выхода не сохранилась",
            "",
            "| № | Участник | Username | Telegram ID | Последняя активность |",
            "|---:|---|---|---:|---|",
        ]
    )
    for index, user in enumerate(undated, start=1):
        username = f"@{user['username']}" if user.get("username") else ""
        lines.append(
            "| {index} | {name} | {username} | {telegram_id} | {activity} |".format(
                index=index,
                name=escape_markdown(display_name(user)),
                username=escape_markdown(username),
                telegram_id=escape_markdown(user["telegram_id"]),
                activity=format_datetime(user.get("last_activity_at")),
            )
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    if not SNAPSHOT_PATH.exists():
        raise FileNotFoundError(f"Не найден свежий snapshot: {SNAPSHOT_PATH}")
    snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    users = snapshot["users"]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    current_path = OUTPUT_DIR / "current_members_by_last_activity.md"
    left_path = OUTPUT_DIR / "left_members_by_leave_date.md"
    current_path.write_text(render_current_members(snapshot, users), encoding="utf-8")
    left_path.write_text(render_left_members(snapshot, users), encoding="utf-8")
    print(f"Текущие участники: {current_path}")
    print(f"Ушедшие: {left_path}")


if __name__ == "__main__":
    main()
