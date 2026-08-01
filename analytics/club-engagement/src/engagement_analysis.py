from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy.stats import fisher_exact


ANALYSIS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ANALYSIS_ROOT.parents[1]
RAW_DIR = ANALYSIS_ROOT / "data" / "raw"
OUTPUT_DIR = ANALYSIS_ROOT / "outputs"
FIGURES_DIR = OUTPUT_DIR / "figures"
TABLES_DIR = OUTPUT_DIR / "tables"
PRIVATE_DIR = OUTPUT_DIR / "private"
NOTEBOOK_PATH = ANALYSIS_ROOT / "notebooks" / "club_engagement_analysis.ipynb"
LOCAL_TZ = "Asia/Yekaterinburg"
CURRENT_TELEGRAM_STATUSES = {"member", "administrator", "creator"}
WINDOWS: dict[str, int | None] = {"7d": 7, "30d": 30, "90d": 90, "all": None}


def _read_jsonl(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Не найден обязательный snapshot: {path}")
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return pd.DataFrame(records)


def _id_string(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _participant_code(telegram_id: str) -> str:
    digest = hashlib.sha256(f"mozhno-club-engagement-v1:{telegram_id}".encode()).hexdigest()
    return f"P-{digest[:8]}"


def _resolve_messages_path() -> Path:
    candidates = list(
        (REPO_ROOT / "tools" / "telegram-topic-export" / "data" / "exports").glob(
            "club_all_*/messages.jsonl"
        )
    )
    if not candidates:
        raise FileNotFoundError("Не найдена полная выгрузка клуба club_all_*/messages.jsonl")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def _prepare_directories() -> None:
    for directory in (FIGURES_DIR, TABLES_DIR, PRIVATE_DIR, NOTEBOOK_PATH.parent):
        directory.mkdir(parents=True, exist_ok=True)


def _load_sources() -> dict[str, Any]:
    messages_path = _resolve_messages_path()
    messages = _read_jsonl(messages_path)
    users = _read_jsonl(RAW_DIR / "users.jsonl")
    events = _read_jsonl(RAW_DIR / "events.jsonl")
    statuses = _read_jsonl(RAW_DIR / "member_statuses.jsonl")
    admins_snapshot = json.loads((RAW_DIR / "admins.json").read_text(encoding="utf-8"))
    attendance_path = ANALYSIS_ROOT / "data" / "attendance.csv"
    if attendance_path.exists():
        attendance = pd.read_csv(attendance_path, dtype={"telegram_id": "string"})
        required_attendance = {"telegram_id", "event_date", "event_name"}
        if not required_attendance.issubset(attendance.columns):
            raise ValueError(
                "data/attendance.csv должен содержать telegram_id,event_date,event_name"
            )
        attendance["telegram_id"] = attendance["telegram_id"].map(_id_string)
        attendance["event_at"] = (
            pd.to_datetime(attendance["event_date"], errors="raise")
            .dt.tz_localize(LOCAL_TZ)
            .dt.tz_convert("UTC")
        )
    else:
        attendance = pd.DataFrame(columns=["telegram_id", "event_date", "event_name", "event_at"])

    if messages["id"].duplicated().any():
        raise ValueError("В выгрузке сообщений обнаружены повторяющиеся ID")
    if not messages["id"].is_monotonic_increasing:
        raise ValueError("Сообщения расположены не по возрастанию ID")
    if users["telegram_id"].duplicated().any() or statuses["telegram_id"].duplicated().any():
        raise ValueError("В snapshot пользователей обнаружены повторяющиеся Telegram ID")

    for frame, columns in (
        (messages, ["sender_id"]),
        (users, ["telegram_id"]),
        (statuses, ["telegram_id"]),
        (events, ["user_id", "target_user_id"]),
    ):
        for column in columns:
            frame[column] = frame[column].map(_id_string)

    messages["date"] = pd.to_datetime(messages["date"], utc=True)
    messages["date_local"] = messages["date"].dt.tz_convert(LOCAL_TZ)
    events["occurred_at"] = pd.to_datetime(events["occurred_at"], utc=True)
    events["occurred_local"] = events["occurred_at"].dt.tz_convert(LOCAL_TZ)
    for column in ("joined_at", "left_at", "first_seen_at", "last_seen_at"):
        users[column] = pd.to_datetime(users[column], utc=True, errors="coerce")

    for column in ("is_bot", "sender_is_bot"):
        if column in users.columns:
            users[column] = users[column].astype("boolean").fillna(False).astype(bool)
        if column in messages.columns:
            messages[column] = messages[column].astype("boolean").fillna(False).astype(bool)

    as_of = max(messages["date"].max(), events["occurred_at"].max())
    admin_status_by_id = {
        str(item["telegram_id"]): item["status"] for item in admins_snapshot.get("admins", [])
    }

    return {
        "messages_path": messages_path,
        "messages": messages,
        "users": users,
        "events": events,
        "statuses": statuses,
        "admins_snapshot": admins_snapshot,
        "admin_status_by_id": admin_status_by_id,
        "attendance": attendance,
        "as_of": as_of,
    }


def _build_population(data: dict[str, Any]) -> pd.DataFrame:
    users = data["users"].copy()
    statuses = data["statuses"][["telegram_id", "status", "is_bot"]].rename(
        columns={"status": "telegram_status", "is_bot": "status_is_bot"}
    )
    population = users.merge(statuses, on="telegram_id", how="outer")

    message_authors = set(data["messages"]["sender_id"].dropna())
    known_ids = set(population["telegram_id"].dropna())
    missing_ids = sorted(message_authors - known_ids)
    if missing_ids:
        population = pd.concat(
            [
                population,
                pd.DataFrame(
                    {
                        "telegram_id": missing_ids,
                        "is_bot": False,
                        "club_status": "UNKNOWN",
                        "telegram_status": "UNKNOWN",
                    }
                ),
            ],
            ignore_index=True,
        )

    population["is_bot"] = population["is_bot"].fillna(population["status_is_bot"]).fillna(False)
    population = population.loc[~population["is_bot"]].copy()
    population["is_current_member"] = population["telegram_status"].isin(CURRENT_TELEGRAM_STATUSES)
    population["membership_state"] = np.select(
        [
            population["is_current_member"],
            population["telegram_status"].eq("left"),
            population["telegram_status"].eq("kicked"),
        ],
        ["Текущий участник", "Вышел", "Удалён"],
        default="Статус не подтверждён",
    )

    admin_status = data["admin_status_by_id"]
    population["community_role"] = population["telegram_id"].map(
        lambda user_id: (
            "Владелец"
            if admin_status.get(user_id) == "creator"
            else "Администратор"
            if admin_status.get(user_id) == "administrator"
            else "Участник"
        )
    )
    population["participant"] = population["telegram_id"].map(_participant_code)

    cancellations_path = ANALYSIS_ROOT / "data" / "subscription_cancellations.csv"
    if cancellations_path.exists():
        cancellations = pd.read_csv(cancellations_path, dtype={"telegram_id": "string"})
        required = {"telegram_id", "canceled_at"}
        if not required.issubset(cancellations.columns):
            raise ValueError(
                "data/subscription_cancellations.csv должен содержать telegram_id,canceled_at"
            )
        cancellations["telegram_id"] = cancellations["telegram_id"].map(_id_string)
        cancellations["subscription_canceled_at"] = pd.to_datetime(
            cancellations["canceled_at"], utc=True, errors="raise"
        )
        if cancellations["telegram_id"].duplicated().any():
            raise ValueError("В списке отмен подписки есть повторяющиеся telegram_id")
        population = population.merge(
            cancellations[["telegram_id", "subscription_canceled_at"]],
            on="telegram_id",
            how="left",
        )
    else:
        population["subscription_canceled_at"] = pd.NaT
    population["subscription_canceled"] = population["subscription_canceled_at"].notna()
    return population


def _build_reply_edges(messages: pd.DataFrame) -> pd.DataFrame:
    author_by_message = messages.set_index("id")["sender_id"]
    reply_edges = messages.loc[messages["reply_to"].notna(), ["id", "date", "date_local", "sender_id", "reply_to"]].copy()
    reply_edges["target_id"] = reply_edges["reply_to"].map(author_by_message)
    reply_edges = reply_edges.loc[
        reply_edges["sender_id"].notna()
        & reply_edges["target_id"].notna()
        & reply_edges["sender_id"].ne(reply_edges["target_id"])
    ]
    return reply_edges


def _positive_reactions(events: pd.DataFrame) -> pd.DataFrame:
    reactions = events.loc[events["event_type"].eq("reaction_changed")].copy()

    def added_count(payload: Any) -> int:
        return len(payload.get("added", [])) if isinstance(payload, dict) else 0

    reactions["reaction_count"] = reactions["payload"].map(added_count)
    return reactions.loc[reactions["reaction_count"].gt(0)]


def _metrics_for_window(
    population_ids: pd.Index,
    messages: pd.DataFrame,
    reply_edges: pd.DataFrame,
    reactions: pd.DataFrame,
    attendance: pd.DataFrame,
    as_of: pd.Timestamp,
    label: str,
    days: int | None,
) -> pd.DataFrame:
    cutoff = messages["date"].min() if days is None else as_of - pd.Timedelta(days=days)
    window_messages = messages.loc[messages["date"].between(cutoff, as_of)].copy()
    window_replies = reply_edges.loc[reply_edges["date"].between(cutoff, as_of)].copy()
    window_reactions = reactions.loc[reactions["occurred_at"].between(cutoff, as_of)].copy()
    window_attendance = attendance.loc[attendance["event_at"].between(cutoff, as_of)].copy()

    metrics = pd.DataFrame(index=population_ids)
    by_author = window_messages.groupby("sender_id")
    metrics[f"messages_{label}"] = by_author.size()
    metrics[f"active_days_{label}"] = by_author["date_local"].nunique()
    metrics[f"active_weeks_{label}"] = by_author["date_local"].agg(
        lambda values: values.dt.strftime("%G-%V").nunique()
    )
    metrics[f"replies_sent_{label}"] = by_author["reply_to"].agg(lambda values: values.notna().sum())
    metrics[f"original_posts_{label}"] = by_author["reply_to"].agg(lambda values: values.isna().sum())
    metrics[f"topics_{label}"] = by_author["topic_id"].nunique()
    metrics[f"replies_received_{label}"] = window_replies.groupby("target_id").size()

    outgoing = window_replies[["sender_id", "target_id"]].rename(
        columns={"sender_id": "person_id", "target_id": "other_id"}
    )
    incoming = window_replies[["sender_id", "target_id"]].rename(
        columns={"target_id": "person_id", "sender_id": "other_id"}
    )
    interlocutors = pd.concat([outgoing, incoming], ignore_index=True)
    metrics[f"interlocutors_{label}"] = interlocutors.groupby("person_id")["other_id"].nunique()
    metrics[f"reactions_given_{label}"] = window_reactions.groupby("user_id")["reaction_count"].sum()
    metrics[f"reactions_received_{label}"] = window_reactions.groupby("target_user_id")[
        "reaction_count"
    ].sum()
    metrics[f"visits_{label}"] = window_attendance.groupby("telegram_id").size()
    return metrics.fillna(0).astype(int)


def _build_participant_metrics(data: dict[str, Any], population: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    messages = data["messages"].loc[
        data["messages"]["sender_id"].notna() & ~data["messages"]["sender_is_bot"]
    ].copy()
    events = data["events"]
    reply_edges = _build_reply_edges(messages)
    reactions = _positive_reactions(events)

    metrics = population.set_index("telegram_id").copy()
    for label, days in WINDOWS.items():
        metrics = metrics.join(
            _metrics_for_window(
                metrics.index,
                messages,
                reply_edges,
                reactions,
                data["attendance"],
                data["as_of"],
                label,
                days,
            )
        )

    message_span = messages.groupby("sender_id")["date"].agg(first_message_at="min", last_message_at="max")
    metrics = metrics.join(message_span)
    metrics["days_since_last_message"] = (
        (data["as_of"] - metrics["last_message_at"]).dt.total_seconds() / 86400
    ).floordiv(1)

    observation_start = metrics["joined_at"].copy()
    observation_start = observation_start.where(observation_start.notna(), metrics["first_message_at"])
    observation_start = observation_start.where(observation_start.notna(), messages["date"].min())
    observation_start = observation_start.where(observation_start.ge(messages["date"].min()), messages["date"].min())
    metrics["observed_days"] = (
        ((data["as_of"] - observation_start).dt.total_seconds() / 86400).floordiv(1) + 1
    ).clip(lower=1)
    metrics["messages_per_30_observed_days"] = (
        metrics["messages_all"] * 30 / metrics["observed_days"]
    ).round(2)
    metrics["available_weeks"] = np.ceil(metrics["observed_days"] / 7).astype(int)
    metrics["active_week_share"] = (
        metrics["active_weeks_all"] / metrics["available_weeks"]
    ).clip(upper=1).round(3)

    current_with_messages = metrics.loc[
        metrics["is_current_member"] & metrics["messages_30d"].gt(0), "messages_30d"
    ]
    core_threshold = int(math.ceil(current_with_messages.quantile(0.80))) if len(current_with_messages) else 1

    def segment(row: pd.Series) -> str:
        if not row["is_current_member"]:
            return row["membership_state"]
        if row["messages_all"] == 0:
            return "Без сообщений"
        if row["days_since_last_message"] <= 30:
            if row["messages_30d"] >= core_threshold and row["active_weeks_30d"] >= 3:
                return "Активное ядро"
            if row["active_weeks_30d"] >= 2:
                return "Регулярно активен"
            return "Эпизодически активен"
        if row["days_since_last_message"] <= 90:
            return "Неактивен 30–90 дней"
        return "Неактивен 90+ дней"

    metrics["segment"] = metrics.apply(segment, axis=1)
    metrics["core_message_threshold_30d"] = core_threshold
    return metrics.reset_index(), reply_edges, reactions


def _weekly_activity(
    messages: pd.DataFrame,
    reactions: pd.DataFrame,
    admin_ids: set[str],
) -> pd.DataFrame:
    work = messages.loc[messages["sender_id"].notna() & ~messages["sender_is_bot"]].copy()
    local_days = work["date_local"].dt.normalize()
    work["week_start"] = local_days - pd.to_timedelta(local_days.dt.weekday, unit="D")
    weekly = work.groupby("week_start").agg(
        messages=("id", "size"),
        active_people=("sender_id", "nunique"),
        replies=("reply_to", lambda values: values.notna().sum()),
        active_topics=("topic_id", "nunique"),
    )
    admin_weekly = (
        work.loc[work["sender_id"].isin(admin_ids)].groupby("week_start").size().rename("owner_admin_messages")
    )
    reaction_work = reactions.copy()
    reaction_days = reaction_work["occurred_local"].dt.normalize()
    reaction_work["week_start"] = reaction_days - pd.to_timedelta(reaction_days.dt.weekday, unit="D")
    reaction_weekly = reaction_work.groupby("week_start")["reaction_count"].sum().rename("reactions_added")
    weekly = weekly.join(admin_weekly, how="left").join(reaction_weekly, how="left").fillna(0)
    full_index = pd.date_range(weekly.index.min(), weekly.index.max(), freq="7D", tz=LOCAL_TZ)
    weekly = weekly.reindex(full_index, fill_value=0)
    weekly.index.name = "week_start"
    return weekly.reset_index()


def _topic_summary(messages: pd.DataFrame) -> pd.DataFrame:
    topics = messages.loc[messages["sender_id"].notna() & ~messages["sender_is_bot"]].copy()
    topics["topic_title"] = topics["topic_title"].fillna("Без темы")
    return (
        topics.groupby(["topic_id", "topic_title"], dropna=False)
        .agg(messages=("id", "size"), active_people=("sender_id", "nunique"), replies=("reply_to", lambda v: v.notna().sum()))
        .reset_index()
        .sort_values("messages", ascending=False)
    )


def _cohort_retention(
    messages: pd.DataFrame,
    participant_metrics: pd.DataFrame,
    as_of: pd.Timestamp,
) -> pd.DataFrame:
    members = participant_metrics.loc[
        participant_metrics["joined_at"].notna()
        & participant_metrics["community_role"].eq("Участник")
        & participant_metrics["joined_at"].ge(messages["date"].min())
        & participant_metrics["joined_at"].le(as_of),
        ["telegram_id", "joined_at"],
    ].copy()
    if members.empty:
        return pd.DataFrame(columns=["cohort", "cohort_size", "M0", "M1", "M2", "M3", "M4", "M5"])

    members["cohort"] = members["joined_at"].dt.tz_convert(LOCAL_TZ).dt.strftime("%Y-%m")
    member_messages = messages[["sender_id", "date"]].merge(
        members, left_on="sender_id", right_on="telegram_id", how="inner"
    )
    member_messages["age_days"] = (
        (member_messages["date"] - member_messages["joined_at"]).dt.total_seconds() / 86400
    )
    member_messages = member_messages.loc[member_messages["age_days"].ge(0)]
    member_messages["age_month"] = (member_messages["age_days"] // 30).astype(int)

    rows: list[dict[str, Any]] = []
    for cohort, cohort_members in members.groupby("cohort"):
        row: dict[str, Any] = {"cohort": cohort, "cohort_size": len(cohort_members)}
        cohort_activity = member_messages.loc[member_messages["cohort"].eq(cohort)]
        for month in range(6):
            eligible = cohort_members.loc[
                cohort_members["joined_at"] + pd.Timedelta(days=(month + 1) * 30) <= as_of
            ]
            if len(eligible) < 3:
                row[f"M{month}"] = np.nan
                continue
            active = cohort_activity.loc[
                cohort_activity["age_month"].eq(month)
                & cohort_activity["telegram_id"].isin(eligible["telegram_id"]),
                "telegram_id",
            ].nunique()
            row[f"M{month}"] = round(active / len(eligible), 3)
        rows.append(row)
    return pd.DataFrame(rows).sort_values("cohort")


def _retention_factor_analysis(
    messages: pd.DataFrame,
    reply_edges: pd.DataFrame,
    participant_metrics: pd.DataFrame,
    as_of: pd.Timestamp,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    eligible_people = participant_metrics.loc[
        participant_metrics["community_role"].eq("Участник")
        & participant_metrics["messages_all"].gt(0),
        ["telegram_id"],
    ]
    work = messages.loc[messages["sender_id"].isin(eligible_people["telegram_id"])].copy()
    first_messages = (
        work.sort_values(["date", "id"]).groupby("sender_id", as_index=False).first()[
            ["sender_id", "id", "date"]
        ].rename(columns={"id": "first_message_id", "date": "first_message_at"})
    )
    first_messages = first_messages.loc[
        first_messages["first_message_at"] + pd.Timedelta(days=60) <= as_of
    ].copy()
    if first_messages.empty:
        return pd.DataFrame(), pd.DataFrame()

    replies_to_first = messages[["sender_id", "reply_to", "date"]].merge(
        first_messages,
        left_on="reply_to",
        right_on="first_message_id",
        how="inner",
        suffixes=("_reply", "_person"),
    )
    replies_to_first = replies_to_first.loc[
        replies_to_first["sender_id_reply"].ne(replies_to_first["sender_id_person"])
        & replies_to_first["date"].ge(replies_to_first["first_message_at"])
    ]
    first_reply = replies_to_first.groupby("sender_id_person")["date"].min().rename("first_reply_at")
    factors = first_messages.set_index("sender_id").join(first_reply)
    factors["first_reply_hours"] = (
        (factors["first_reply_at"] - factors["first_message_at"]).dt.total_seconds() / 3600
    )
    factors["quick_first_reply"] = factors["first_reply_hours"].between(0, 24, inclusive="both")

    message_age = work.merge(
        factors[["first_message_at"]], left_on="sender_id", right_index=True, how="inner"
    )
    message_age["days_from_first"] = (
        (message_age["date"] - message_age["first_message_at"]).dt.total_seconds() / 86400
    )
    retained = (
        message_age.loc[message_age["days_from_first"].between(30, 60, inclusive="left")]
        .groupby("sender_id")
        .size()
        .gt(0)
    )
    factors["returned_days_30_60"] = (
        factors.index.to_series().map(retained).astype("boolean").fillna(False).astype(bool)
    )

    first_30_messages = message_age.loc[
        message_age["days_from_first"].between(0, 30, inclusive="left")
    ]
    topic_breadth = first_30_messages.groupby("sender_id")["topic_id"].nunique()
    factors["topics_first_30d"] = factors.index.to_series().map(topic_breadth).fillna(0).astype(int)

    edges = reply_edges.copy()
    outgoing = edges.rename(columns={"sender_id": "person_id", "target_id": "other_id"})
    incoming = edges.rename(columns={"target_id": "person_id", "sender_id": "other_id"})
    connections = pd.concat(
        [outgoing[["person_id", "other_id", "date"]], incoming[["person_id", "other_id", "date"]]],
        ignore_index=True,
    ).merge(factors[["first_message_at"]], left_on="person_id", right_index=True, how="inner")
    connections["days_from_first"] = (
        (connections["date"] - connections["first_message_at"]).dt.total_seconds() / 86400
    )
    connection_breadth = (
        connections.loc[connections["days_from_first"].between(0, 30, inclusive="left")]
        .groupby("person_id")["other_id"]
        .nunique()
    )
    factors["interlocutors_first_30d"] = (
        factors.index.to_series().map(connection_breadth).fillna(0).astype(int)
    )
    factors["two_plus_topics"] = factors["topics_first_30d"].ge(2)
    factors["two_plus_interlocutors"] = factors["interlocutors_first_30d"].ge(2)

    comparison_rows: list[dict[str, Any]] = []
    labels = {
        "quick_first_reply": "Первый ответ получен не позднее 24 часов",
        "two_plus_interlocutors": "Не менее двух собеседников за первые 30 дней",
        "two_plus_topics": "Активность минимум в двух темах за первые 30 дней",
    }
    for column, label in labels.items():
        with_factor = factors.loc[factors[column]]
        without_factor = factors.loc[~factors[column]]
        with_retained = int(with_factor["returned_days_30_60"].sum())
        without_retained = int(without_factor["returned_days_30_60"].sum())
        with_rate = with_retained / len(with_factor) if len(with_factor) else np.nan
        without_rate = without_retained / len(without_factor) if len(without_factor) else np.nan
        p_value = np.nan
        if len(with_factor) and len(without_factor):
            _, p_value = fisher_exact(
                [
                    [with_retained, len(with_factor) - with_retained],
                    [without_retained, len(without_factor) - without_retained],
                ]
            )
        comparison_rows.append(
            {
                "factor": label,
                "with_factor_n": len(with_factor),
                "with_factor_return_rate": with_rate,
                "without_factor_n": len(without_factor),
                "without_factor_return_rate": without_rate,
                "difference_pp": (with_rate - without_rate) * 100,
                "fisher_p_value": p_value,
            }
        )
    factors = factors.reset_index().rename(columns={"sender_id": "telegram_id"})
    return pd.DataFrame(comparison_rows), factors


def _gini(values: pd.Series) -> float:
    array = np.sort(values.to_numpy(dtype=float))
    if len(array) == 0 or array.sum() == 0:
        return 0.0
    index = np.arange(1, len(array) + 1)
    return float((2 * np.sum(index * array) / (len(array) * array.sum())) - (len(array) + 1) / len(array))


def _exit_group_comparison(
    participant_metrics: pd.DataFrame,
    retention_people: pd.DataFrame,
) -> pd.DataFrame:
    if retention_people.empty:
        return pd.DataFrame()
    groups = retention_people.merge(
        participant_metrics[["telegram_id", "is_current_member", "telegram_status"]],
        on="telegram_id",
        how="left",
    )
    groups["group"] = np.select(
        [groups["is_current_member"], groups["telegram_status"].eq("left")],
        ["Текущие", "Вышедшие"],
        default="Не подтверждено",
    )
    groups = groups.loc[groups["group"].isin(["Текущие", "Вышедшие"])]
    if groups.empty:
        return pd.DataFrame()
    return (
        groups.groupby("group")
        .agg(
            people=("telegram_id", "size"),
            quick_first_reply_rate=("quick_first_reply", "mean"),
            return_days_30_60_rate=("returned_days_30_60", "mean"),
            median_topics_first_30d=("topics_first_30d", "median"),
            median_interlocutors_first_30d=("interlocutors_first_30d", "median"),
        )
        .reset_index()
    )


def _summary_payload(
    data: dict[str, Any],
    participant_metrics: pd.DataFrame,
    weekly: pd.DataFrame,
    comparisons: pd.DataFrame,
) -> dict[str, Any]:
    active_counts = {
        label: int(participant_metrics[f"messages_{label}"].gt(0).sum()) for label in WINDOWS
    }
    message_counts = {
        label: int(participant_metrics[f"messages_{label}"].sum()) for label in WINDOWS
    }
    visit_counts = {
        label: int(participant_metrics[f"visits_{label}"].sum()) for label in WINDOWS
    }
    author_counts = participant_metrics.loc[participant_metrics["messages_all"].gt(0), "messages_all"].sort_values(
        ascending=False
    )
    top_n = max(1, math.ceil(len(author_counts) * 0.10)) if len(author_counts) else 0
    top_10_share = author_counts.head(top_n).sum() / author_counts.sum() if len(author_counts) else 0

    as_of_local = data["as_of"].tz_convert(LOCAL_TZ)
    current_week_start = as_of_local.normalize() - pd.Timedelta(days=as_of_local.weekday())
    completed = weekly.loc[weekly["week_start"].lt(current_week_start)].tail(8)
    recent = completed.tail(4)
    previous = completed.head(max(0, len(completed) - 4)).tail(4)
    active_trend_pct = np.nan
    message_trend_pct = np.nan
    if len(recent) == 4 and len(previous) == 4 and previous["active_people"].mean() > 0:
        active_trend_pct = (recent["active_people"].mean() / previous["active_people"].mean() - 1) * 100
    if len(recent) == 4 and len(previous) == 4 and previous["messages"].mean() > 0:
        message_trend_pct = (recent["messages"].mean() / previous["messages"].mean() - 1) * 100

    return {
        "as_of": data["as_of"].isoformat(),
        "message_period_start": data["messages"]["date"].min().isoformat(),
        "message_period_end": data["messages"]["date"].max().isoformat(),
        "messages_total": int(len(data["messages"])),
        "known_people": int(len(participant_metrics)),
        "telegram_member_count_including_bots": int(data["admins_snapshot"]["member_count"]),
        "confirmed_current_humans": int(participant_metrics["is_current_member"].sum()),
        "confirmed_left_humans": int(participant_metrics["telegram_status"].eq("left").sum()),
        "unconfirmed_status_humans": int(participant_metrics["telegram_status"].eq("API_ERROR").sum()),
        "active_people": active_counts,
        "messages": message_counts,
        "visits": visit_counts,
        "top_10_percent_message_share": round(float(top_10_share), 4),
        "message_gini": round(_gini(author_counts), 4),
        "active_people_trend_last_4_full_weeks_pct": None if pd.isna(active_trend_pct) else round(float(active_trend_pct), 1),
        "messages_trend_last_4_full_weeks_pct": None if pd.isna(message_trend_pct) else round(float(message_trend_pct), 1),
        "factor_comparisons": comparisons.replace({np.nan: None}).to_dict(orient="records"),
        "attendance_available": (ANALYSIS_ROOT / "data" / "attendance.csv").exists(),
        "subscription_cancellations_available": (
            ANALYSIS_ROOT / "data" / "subscription_cancellations.csv"
        ).exists(),
        "subscription_cancellations_count": int(participant_metrics["subscription_canceled"].sum()),
    }


def _plot_weekly(weekly: pd.DataFrame) -> None:
    fig, ax_messages = plt.subplots(figsize=(13, 6))
    ax_messages.bar(weekly["week_start"], weekly["messages"], width=5, color="#8FB9A8", alpha=0.8)
    ax_messages.set_ylabel("Сообщения")
    ax_messages.set_xlabel("")
    ax_active = ax_messages.twinx()
    ax_active.plot(weekly["week_start"], weekly["active_people"], color="#E26D5A", marker="o", linewidth=2)
    ax_active.set_ylabel("Активные люди")
    ax_messages.set_title("Недельная активность: сообщения и уникальные авторы")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "weekly_activity.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _plot_windows(summary: dict[str, Any]) -> None:
    labels = ["7 дней", "30 дней", "90 дней", "Весь период"]
    keys = ["7d", "30d", "90d", "all"]
    values = [summary["active_people"][key] for key in keys]
    fig, ax = plt.subplots(figsize=(9, 5))
    bars = ax.bar(labels, values, color=["#E26D5A", "#E9A03B", "#6D9DC5", "#506C64"])
    ax.bar_label(bars, padding=3)
    ax.set_ylabel("Уникальные авторы")
    ax.set_title("Сколько людей писали в разных временных окнах")
    ax.set_ylim(0, max(values) * 1.15 if max(values) else 1)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "active_people_windows.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _plot_segments(participant_metrics: pd.DataFrame) -> None:
    order = [
        "Активное ядро",
        "Регулярно активен",
        "Эпизодически активен",
        "Неактивен 30–90 дней",
        "Неактивен 90+ дней",
        "Без сообщений",
    ]
    counts = (
        participant_metrics.loc[participant_metrics["is_current_member"], "segment"]
        .value_counts()
        .reindex(order, fill_value=0)
    )
    fig, ax = plt.subplots(figsize=(10, 5.5))
    bars = ax.barh(counts.index[::-1], counts.values[::-1], color="#6D9DC5")
    ax.bar_label(bars, padding=3)
    ax.set_xlabel("Люди")
    ax.set_title("Сегменты подтверждённых текущих участников")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "current_member_segments.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _plot_cohorts(cohorts: pd.DataFrame) -> None:
    values = cohorts.set_index("cohort")[[f"M{i}" for i in range(6)]] if not cohorts.empty else pd.DataFrame()
    fig, ax = plt.subplots(figsize=(10, max(3.5, 0.65 * max(1, len(values)))))
    if values.empty or values.notna().sum().sum() == 0:
        ax.text(0.5, 0.5, "Недостаточно полных когорт", ha="center", va="center")
        ax.axis("off")
    else:
        sns.heatmap(values * 100, annot=True, fmt=".0f", cmap="YlGnBu", vmin=0, vmax=100, cbar_kws={"label": "% активных"}, ax=ax)
        ax.set_xlabel("Месяц после вступления")
        ax.set_ylabel("Когорта вступления")
        ax.set_title("Возврат к сообщениям по когортам")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "cohort_retention.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _plot_factors(comparisons: pd.DataFrame) -> None:
    plot_data = comparisons.copy()
    plot_data["С фактором"] = plot_data["with_factor_return_rate"] * 100
    plot_data["Без фактора"] = plot_data["without_factor_return_rate"] * 100
    long = plot_data.melt(
        id_vars="factor",
        value_vars=["С фактором", "Без фактора"],
        var_name="Группа",
        value_name="Вернулись на 30–60-й день, %",
    )
    fig, ax = plt.subplots(figsize=(12, 6))
    sns.barplot(data=long, y="factor", x="Вернулись на 30–60-й день, %", hue="Группа", ax=ax, palette=["#506C64", "#C9D6D1"])
    ax.set_ylabel("")
    ax.set_title("Наблюдаемые факторы раннего возврата")
    ax.legend(title="")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "early_retention_factors.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _plot_topics(topics: pd.DataFrame) -> None:
    top = topics.head(12).sort_values("messages")
    fig, ax = plt.subplots(figsize=(11, 6.5))
    bars = ax.barh(top["topic_title"], top["messages"], color="#8FB9A8")
    ax.bar_label(bars, padding=3)
    ax.set_xlabel("Сообщения")
    ax.set_title("Темы с наибольшим объёмом общения")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "top_topics.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _plot_exit_comparison(exit_comparison: pd.DataFrame) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    if exit_comparison.empty or len(exit_comparison) < 2:
        axes[0].text(0.5, 0.5, "Недостаточно подтверждённых групп", ha="center", va="center")
        axes[0].axis("off")
        axes[1].axis("off")
    else:
        rates = exit_comparison.melt(
            id_vars=["group", "people"],
            value_vars=["quick_first_reply_rate", "return_days_30_60_rate"],
            var_name="metric",
            value_name="value",
        )
        rates["metric"] = rates["metric"].map(
            {
                "quick_first_reply_rate": "Первый ответ ≤24 ч",
                "return_days_30_60_rate": "Вернулся на 30–60-й день",
            }
        )
        sns.barplot(data=rates, x="metric", y="value", hue="group", ax=axes[0])
        axes[0].set_ylim(0, 1)
        axes[0].set_ylabel("Доля")
        axes[0].set_xlabel("")
        axes[0].tick_params(axis="x", rotation=15)
        axes[0].legend(title="")

        breadth = exit_comparison.melt(
            id_vars=["group", "people"],
            value_vars=["median_topics_first_30d", "median_interlocutors_first_30d"],
            var_name="metric",
            value_name="value",
        )
        breadth["metric"] = breadth["metric"].map(
            {
                "median_topics_first_30d": "Темы",
                "median_interlocutors_first_30d": "Собеседники",
            }
        )
        sns.barplot(data=breadth, x="metric", y="value", hue="group", ax=axes[1])
        axes[1].set_ylabel("Медиана за первые 30 дней")
        axes[1].set_xlabel("")
        axes[1].legend(title="")
    fig.suptitle("Текущие и подтверждённо вышедшие: ранний опыт")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "current_vs_left.png", dpi=170, bbox_inches="tight")
    plt.close(fig)


def _format_pct(value: float | None) -> str:
    return "н/д" if value is None or pd.isna(value) else f"{value * 100:.1f}%"


def _write_report(
    data: dict[str, Any],
    summary: dict[str, Any],
    participant_metrics: pd.DataFrame,
    comparisons: pd.DataFrame,
    exit_comparison: pd.DataFrame,
) -> Path:
    as_of_local = data["as_of"].tz_convert(LOCAL_TZ)
    message_start = data["messages"]["date"].min().tz_convert(LOCAL_TZ)
    reaction_start = data["events"].loc[
        data["events"]["event_type"].eq("reaction_changed"), "occurred_at"
    ].min().tz_convert(LOCAL_TZ)
    membership_events = data["events"].loc[
        data["events"]["event_type"].isin(["member_joined", "member_left", "member_removed"])
    ]
    membership_start = membership_events["occurred_at"].min().tz_convert(LOCAL_TZ)
    segments = participant_metrics.loc[participant_metrics["is_current_member"], "segment"].value_counts()

    lines = [
        "# Вовлечённость участников клуба «МОЖНО»",
        "",
        f"Срез данных: **{as_of_local:%d.%m.%Y %H:%M} YEKT**.",
        "",
        "## Что измерено",
        "",
        f"- Сообщения: {summary['messages_total']:,} записей с {message_start:%d.%m.%Y}.",
        f"- Подтверждённые текущие участники без ботов: {summary['confirmed_current_humans']} из {summary['telegram_member_count_including_bots']} аккаунтов в Telegram-группе.",
        f"- Подтверждённо вышли: {summary['confirmed_left_humans']}; ещё у {summary['unconfirmed_status_humans']} известных аккаунтов Telegram API не подтвердил текущий статус — они не считаются добровольно ушедшими.",
        f"- Реакции доступны с {reaction_start:%d.%m.%Y}; события вступления и выхода — с {membership_start:%d.%m.%Y}.",
        (
            f"- Отмены платной подписки загружены отдельно: {summary['subscription_cancellations_count']}. Они не смешиваются с выходом из Telegram-группы."
            if summary["subscription_cancellations_available"]
            else "- Известно, что часть людей отменила платную подписку, но список отмен пока не загружен. Такие случаи нельзя автоматически считать уходом из-за невовлечённости."
        ),
        "- Пассивные открытия и чтение Telegram-группы недоступны. Вместо «посещений» используются активные дни и недели.",
        "",
        "## Активность по временным окнам",
        "",
        "| Окно | Писали, человек | Сообщений |",
        "|---|---:|---:|",
        f"| 7 дней | {summary['active_people']['7d']} | {summary['messages']['7d']:,} |",
        f"| 30 дней | {summary['active_people']['30d']} | {summary['messages']['30d']:,} |",
        f"| 90 дней | {summary['active_people']['90d']} | {summary['messages']['90d']:,} |",
        f"| Весь период | {summary['active_people']['all']} | {summary['messages']['all']:,} |",
        "",
        (
            "Посещения встреч: "
            f"7 дней — {summary['visits']['7d']}, 30 дней — {summary['visits']['30d']}, "
            f"90 дней — {summary['visits']['90d']}, весь период — {summary['visits']['all']}."
            if summary["attendance_available"]
            else "Посещения встреч не посчитаны: файл `data/attendance.csv` пока отсутствует."
        ),
        "",
        "## Предварительные инсайты",
        "",
        f"1. **Активность сконцентрирована:** верхние 10% пишущих создали {summary['top_10_percent_message_share'] * 100:.1f}% сообщений; коэффициент Джини — {summary['message_gini']:.2f}. Это показывает зависимость клуба от активного ядра, но само по себе не доказывает проблему.",
    ]

    active_trend = summary["active_people_trend_last_4_full_weeks_pct"]
    message_trend = summary["messages_trend_last_4_full_weeks_pct"]
    if active_trend is not None and message_trend is not None:
        lines.append(
            f"2. **Последние четыре полные недели:** среднее число активных авторов изменилось на {active_trend:+.1f}%, объём сообщений — на {message_trend:+.1f}% относительно предыдущих четырёх недель."
        )
    else:
        lines.append("2. Для корректного сравнения соседних четырёхнедельных периодов пока недостаточно полных недель.")

    for index, row in comparisons.iterrows():
        support = "связь заметна" if abs(row["difference_pp"]) >= 10 else "связь слабая"
        confidence = (
            "статистически различимо на этом срезе"
            if row["fisher_p_value"] < 0.05
            else "на этом размере выборки статистически не подтверждено"
        )
        lines.append(
            f"{index + 3}. **{row['factor']}:** возврат на 30–60-й день — {_format_pct(row['with_factor_return_rate'])} (n={row['with_factor_n']}) против {_format_pct(row['without_factor_return_rate'])} (n={row['without_factor_n']}), разница {row['difference_pp']:+.1f} п.п.; {support}, {confidence}."
        )

    lines.extend(["", "## Текущие и подтверждённо вышедшие", ""])
    if {"Текущие", "Вышедшие"}.issubset(set(exit_comparison.get("group", []))):
        current = exit_comparison.set_index("group").loc["Текущие"]
        left = exit_comparison.set_index("group").loc["Вышедшие"]
        lines.extend(
            [
                f"В сравнение попали {int(current['people'])} текущих и {int(left['people'])} подтверждённо вышедших участников, у которых можно наблюдать первые 60 дней после первого сообщения.",
                "",
                f"- Первый ответ за 24 часа: текущие — {current['quick_first_reply_rate']:.1%}, вышедшие — {left['quick_first_reply_rate']:.1%}.",
                f"- Медиана собеседников за первые 30 дней: текущие — {current['median_interlocutors_first_30d']:.1f}, вышедшие — {left['median_interlocutors_first_30d']:.1f}.",
                f"- Медиана тем за первые 30 дней: текущие — {current['median_topics_first_30d']:.1f}, вышедшие — {left['median_topics_first_30d']:.1f}.",
                "",
                "Это описательное сравнение небольшой группы. Без списка отмен подписки и объяснений самих людей оно не отвечает на вопрос о причине ухода.",
            ]
        )
    else:
        lines.append("Для корректного сравнения пока недостаточно подтверждённо вышедших с полной ранней историей.")

    lines.extend(["", "## Сегменты текущих участников", ""])
    for segment, count in segments.items():
        lines.append(f"- {segment}: {count}")

    lines.extend(
        [
            "",
            "## Как читать результаты",
            "",
            "- Найденные различия — корреляции, а не доказанные причины.",
            "- Возврат измеряется сообщением на 30–60-й день после первого сообщения, а не чтением чата.",
            "- Владелец и администраторы учитываются в динамике клуба, но исключены из сравнения обычных участников.",
            "- Статусы `API_ERROR` не приравнены к выходу: Telegram не подтвердил их текущее состояние.",
            "- Отмена платной подписки, выход из Telegram-группы и снижение активности рассматриваются как три разных события.",
            "- Чтобы понять причины ухода, нужны короткий вопрос при выходе и разговоры с активными, неактивными и ушедшими.",
            "",
            "## Чего пока не хватает",
            "",
            "- посещений офлайн-встреч или других клубных мероприятий;",
            "- пассивных просмотров Telegram — Telegram их не отдаёт;",
            "- причин выхода, сообщённых самим участником;",
            "- списка отмен платной подписки с Telegram ID и датой отмены;",
            "- полной истории членства до 4 июня 2026 года.",
        ]
    )
    report_path = OUTPUT_DIR / "insights.md"
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report_path


def run_analysis() -> dict[str, Any]:
    _prepare_directories()
    sns.set_theme(style="whitegrid", font="DejaVu Sans")
    data = _load_sources()
    population = _build_population(data)
    participant_metrics, reply_edges, reactions = _build_participant_metrics(data, population)
    admin_ids = set(data["admin_status_by_id"])
    weekly = _weekly_activity(data["messages"], reactions, admin_ids)
    topics = _topic_summary(data["messages"])
    cohorts = _cohort_retention(data["messages"], participant_metrics, data["as_of"])
    comparisons, retention_people = _retention_factor_analysis(
        data["messages"], reply_edges, participant_metrics, data["as_of"]
    )
    exit_comparison = _exit_group_comparison(participant_metrics, retention_people)
    summary = _summary_payload(data, participant_metrics, weekly, comparisons)

    private_columns = [
        "participant",
        "community_role",
        "membership_state",
        "telegram_status",
        "segment",
        "joined_at",
        "first_message_at",
        "last_message_at",
        "days_since_last_message",
        "observed_days",
        "messages_per_30_observed_days",
        "active_week_share",
    ] + [
        column
        for column in participant_metrics.columns
        if any(column.startswith(prefix) for prefix in ("messages_", "active_days_", "active_weeks_", "replies_", "topics_", "interlocutors_", "reactions_", "visits_"))
    ]
    participant_metrics[private_columns].to_csv(PRIVATE_DIR / "participant_metrics.csv", index=False)
    if not retention_people.empty:
        retention_people = retention_people.merge(
            participant_metrics[["telegram_id", "participant"]], on="telegram_id", how="left"
        )
        retention_people.drop(columns=["telegram_id"]).to_csv(
            PRIVATE_DIR / "early_retention_people.csv", index=False
        )
    weekly.assign(week_start=weekly["week_start"].dt.date).to_csv(TABLES_DIR / "weekly_activity.csv", index=False)
    topics.to_csv(TABLES_DIR / "topic_summary.csv", index=False)
    cohorts.to_csv(TABLES_DIR / "cohort_retention.csv", index=False)
    comparisons.to_csv(TABLES_DIR / "retention_factor_comparisons.csv", index=False)
    exit_comparison.to_csv(TABLES_DIR / "current_vs_left.csv", index=False)
    (OUTPUT_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    _plot_weekly(weekly)
    _plot_windows(summary)
    _plot_segments(participant_metrics)
    _plot_cohorts(cohorts)
    _plot_factors(comparisons)
    _plot_topics(topics)
    _plot_exit_comparison(exit_comparison)
    report_path = _write_report(data, summary, participant_metrics, comparisons, exit_comparison)

    return {
        "summary": summary,
        "report_path": str(report_path),
        "notebook_path": str(NOTEBOOK_PATH),
        "messages_path": str(data["messages_path"]),
    }
