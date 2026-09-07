# Экспорт одной Telegram-подтемы

Самостоятельный инструмент для выгрузки форумной подтемы Telegram в JSONL и Markdown. Он не входит в Docker Compose платформы и не зависит от каталога со статьями.

По умолчанию используется тема `91` чата `-1003393970920`, `.env` экспортера из `../_utils/tgCHat`, локальная сессия в `tools/telegram-topic-export/data/session/`, а результат записывается в `tools/telegram-topic-export/data/exports/`.

Сначала один раз авторизуйте сессию по QR:

```bash
docker compose -f tools/telegram-topic-export/docker-compose.yml run --rm telegram-session-auth
```

QR сохраняется в `tools/telegram-topic-export/data/session/telegram-login-qr.png`. В Telegram откройте «Настройки → Устройства → Подключить устройство» и отсканируйте его.

```bash
docker compose -f tools/telegram-topic-export/docker-compose.yml run --rm telegram-topic-export
```

Пути и режим скачивания медиа можно переопределить переменными Compose:

```bash
TELEGRAM_EXPORT_CHAT_ID=-1003393970920 \
TELEGRAM_EXPORT_TOPIC_ID=91 \
TELEGRAM_DOWNLOAD_MEDIA=images \
TELEGRAM_EXPORT_ENV_FILE=../../../_utils/tgCHat/.env \
TELEGRAM_EXPORT_SESSION_DIR=./data/session \
TELEGRAM_EXPORT_OUTPUT_DIR=./data/exports \
docker compose -f tools/telegram-topic-export/docker-compose.yml run --rm telegram-topic-export
```

Допустимые режимы `TELEGRAM_DOWNLOAD_MEDIA`: `none`, `images`, `all`. Каждый запуск создает новую датированную директорию и не перезаписывает предыдущий экспорт.
