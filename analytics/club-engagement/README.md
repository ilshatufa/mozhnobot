# Аналитика вовлечённости клуба «МОЖНО»

Отдельный воспроизводимый анализ активности, удержания и ранних признаков
вовлечения участников. Все расчёты запускаются только в Docker.

## Что входит

- метрики по каждому участнику за 7, 30, 90 дней и весь период;
- активные дни и недели вместо недоступных Telegram-просмотров;
- ответы, реакции, число собеседников и охват тем;
- сегменты подтверждённых текущих участников;
- когортный возврат к сообщениям;
- сравнение ранних факторов с возвратом на 30–60-й день;
- недельная динамика, концентрация активности и наиболее активные темы;
- выполненный Jupyter-ноутбук и краткий отчёт с ограничениями выводов.

Отмена платной подписки, выход из Telegram-группы и снижение активности — три
разных события. Без отдельного списка отмен они не объединяются.

## Входные данные

Основная выгрузка сообщений находится вне этого каталога:

`tools/telegram-topic-export/data/exports/club_all_*/messages.jsonl`

Локальные production-snapshots находятся в `data/raw/` и исключены из Git:

- `users.jsonl` — известные пользователи без имён;
- `events.jsonl` — события сообщений, ответов, реакций и членства;
- `member_statuses.jsonl` — read-only проверка фактического статуса через Telegram;
- `admins.json` — владелец, администраторы и общее число участников.

Дополнительные источники подключаются только при наличии реальных данных:

- `data/attendance.csv` по образцу `data/attendance.example.csv`;
- `data/subscription_cancellations.csv` по образцу
  `data/subscription_cancellations.example.csv`.

Оба файла требуют Telegram ID. Список отмен содержит только `telegram_id` и
`canceled_at`; отсутствие человека в списке не считается активной подпиской.

## Запуск анализа

Из корня проекта `mozhno`:

```bash
docker compose -f analytics/club-engagement/docker-compose.yml build analysis
docker compose -f analytics/club-engagement/docker-compose.yml run --rm analysis
```

Выполнить и сохранить ноутбук с графиками:

```bash
docker compose -f analytics/club-engagement/docker-compose.yml run --rm analysis \
  jupyter nbconvert --to notebook --execute --inplace \
  --ExecutePreprocessor.timeout=300 \
  notebooks/club_engagement_analysis.ipynb
```

Открыть Jupyter Lab:

```bash
docker compose -f analytics/club-engagement/docker-compose.yml up notebook
```

После запуска он доступен только локально: `http://127.0.0.1:8888`.

Сформировать приватные списки текущих и ушедших участников из свежего
production-snapshot:

```bash
docker compose -f analytics/club-engagement/docker-compose.yml run --rm analysis \
  python src/export_member_lists.py
```

Результаты сохраняются в `outputs/private/`, не попадают в Git и содержат
имена, username и Telegram ID. Для действующих участников используется дата
последнего зафиксированного действия в клубной группе; пассивное чтение
Telegram определить нельзя. Ушедшие самостоятельно отделены от удалённых
администратором, а записи без сохранённой даты выхода вынесены в отдельный блок.

## Результаты

- `notebooks/club_engagement_analysis.ipynb` — основной выполненный ноутбук;
- `outputs/insights.md` — краткий отчёт;
- `outputs/figures/` — графики;
- `outputs/tables/` — агрегированные таблицы без персональных ID;
- `outputs/private/` — обезличенные метрики по людям, исключённые из Git.

Пассивные чтения Telegram недоступны. Все выводы о причинах являются
наблюдаемыми связями, пока их не подтвердили сами участники.
