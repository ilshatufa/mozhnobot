# ТЗ: скачивание и транскрибация аудио из Telegram-клуба

Дата: 3 июня 2026  
Контекст: расширение MVP аналитики клуба

## 1. Цель

Добавить обработку аудио-сообщений из клубной Telegram-группы:

- фиксировать аудио-метаданные;
- ставить задачи на скачивание;
- скачивать файлы через Telegram Bot API;
- транскрибировать аудио;
- сохранять raw и clean transcript;
- очищать локальные аудиофайлы по retention policy.

Поддерживаемые типы сообщений:

- `voice`;
- `audio`;
- `video_note`;
- `video`.

## 2. Изменения модели данных

### 2.1 `club_message_index`

В `club_message_index` не добавлять аудио-метаданные.

Назначение `club_message_index` остается прежним:

- Telegram ID сообщения;
- автор;
- подтема;
- reply-связь;
- тип сообщения;
- текст/caption;
- время публикации.

Медиа-данные хранятся отдельно в `club_media`.

### 2.2 Новая таблица `club_media`

Хранит медиа-объект, привязанный к Telegram-сообщению.

```prisma
model ClubMedia {
  id                   Int      @id @default(autoincrement())
  messageIndexId       Int      @map("message_index_id")
  chatTelegramId       BigInt   @map("chat_telegram_id")
  telegramMessageId    Int      @map("telegram_message_id")
  mediaType            String   @map("media_type") @db.VarChar(50)
  telegramFileId       String   @map("telegram_file_id") @db.VarChar(255)
  telegramFileUniqueId String?  @map("telegram_file_unique_id") @db.VarChar(255)
  durationSeconds      Int?     @map("duration_seconds")
  fileSize             Int?     @map("file_size")
  mimeType             String?  @map("mime_type") @db.VarChar(255)
  title                String?  @db.VarChar(255)
  performer            String?  @db.VarChar(255)
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([chatTelegramId, telegramMessageId, mediaType])
  @@index([messageIndexId])
  @@index([telegramFileUniqueId])
  @@map("club_media")
}
```

Назначение:

- `messageIndexId` - связь с записью сообщения;
- `chatTelegramId`, `telegramMessageId` - Telegram-идентификаторы для быстрых запросов без join;
- `mediaType` - `voice`, `audio`, `video_note`, `video`;
- `telegramFileId` - нужен для скачивания файла;
- `telegramFileUniqueId` - стабильный идентификатор файла для дедупликации;
- `durationSeconds` - длительность аудио/видео;
- `fileSize` - размер файла;
- `mimeType` - MIME-тип;
- `title`, `performer` - метаданные Telegram `audio`, если есть.

## 3. Новая таблица `media_processing_jobs`

```prisma
enum MediaProcessingStatus {
  PENDING
  DOWNLOADING
  DOWNLOADED
  TRANSCRIBING
  TRANSCRIBED
  FAILED
  SKIPPED
}

model MediaProcessingJob {
  id                   Int      @id @default(autoincrement())
  mediaId              Int      @map("media_id")
  status               MediaProcessingStatus @default(PENDING)
  attempts             Int      @default(0)
  lastError            String?  @map("last_error") @db.Text
  downloadedFilePath   String?  @map("downloaded_file_path") @db.Text
  transcriptRaw        String?  @map("transcript_raw") @db.Text
  transcriptClean      String?  @map("transcript_clean") @db.Text
  transcriptLanguage   String?  @map("transcript_language") @db.VarChar(32)
  transcriptSegments   Json?    @map("transcript_segments")
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  processedAt          DateTime? @map("processed_at") @db.Timestamptz()

  @@index([status, createdAt])
  @@index([mediaId])
  @@map("media_processing_jobs")
}
```

В MVP можно не делать FK на `club_media`, чтобы сохранить простую модель без жестких связей.

## 4. Логика создания job

При `message_created` с типом `voice`, `audio`, `video_note`, `video`:

1. Сохранить сообщение в `club_message_index`.
2. Сохранить медиа-метаданные в `club_media`.
3. Создать `media_processing_jobs` со статусом `PENDING` и `mediaId`.
3. Не скачивать файл прямо внутри Telegram update handler.

Если `telegramFileId` отсутствует, job не создавать.

## 5. Worker скачивания

Отдельный worker внутри Docker:

1. Берет job со статусом `PENDING`.
2. Меняет статус на `DOWNLOADING`.
3. Получает `club_media` по `mediaId`.
4. Вызывает Telegram `getFile(telegramFileId)`.
5. Скачивает файл по URL:

```text
https://api.telegram.org/file/bot<TOKEN>/<file_path>
```

6. Сохраняет файл в Docker volume:

```text
/app/media/YYYY/MM/DD/<telegram_file_unique_id_or_job_id>.<ext>
```

7. Обновляет job:

```text
status = DOWNLOADED
downloadedFilePath = ...
attempts += 1
```

При ошибке:

- увеличить `attempts`;
- записать `lastError`;
- если `attempts < MAX_ATTEMPTS`, вернуть `PENDING`;
- иначе `FAILED`.

## 6. Транскрибация

После `DOWNLOADED`:

1. Менять статус на `TRANSCRIBING`.
2. Конвертировать файл в формат, поддерживаемый OpenAI Transcription API, если нужно.
3. Передать файл в OpenAI Transcription API.
4. Сохранить:
   - `transcriptRaw`;
   - `transcriptLanguage`;
   - `transcriptSegments`, если OpenAI вернул сегменты.
5. Выполнить очистку текста.
6. Сохранить `transcriptClean`.
7. Поставить:

```text
status = TRANSCRIBED
processedAt = now()
```

Транскрибация выполняется только через OpenAI. Другие провайдеры в MVP не используются.

Нужные env:

```env
OPENAI_API_KEY=<ключ OpenAI API>
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_TRANSCRIPTION_LANGUAGE=ru
OPENAI_TRANSCRIPTION_MAX_FILE_SIZE_MB=25
```

`OPENAI_TRANSCRIPTION_LANGUAGE` можно оставить пустым, если нужен автоопределитель языка.

## 7. Очистка transcript

Хранить две версии:

- `transcriptRaw` - сырой результат распознавания;
- `transcriptClean` - очищенный текст.

Clean-логика:

- нормализовать пробелы;
- убрать очевидные повторы;
- привести пунктуацию, если это возможно без потери смысла;
- не удалять смысловые фрагменты;
- не перетирать raw-версию.

## 8. Retention аудиофайлов

Добавить env:

```env
MEDIA_MAX_FILE_SIZE_MB=50
MEDIA_DOWNLOAD_MAX_ATTEMPTS=3
MEDIA_RETENTION_DAYS=7
MEDIA_FAILED_RETENTION_DAYS=14
```

Правила:

- после успешной транскрибации хранить аудиофайл `MEDIA_RETENTION_DAYS`;
- после `FAILED` хранить файл `MEDIA_FAILED_RETENTION_DAYS`;
- transcript в БД не удалять автоматически;
- токен бота и URL скачивания не писать в логи.

## 9. Критерии приемки

Готово, если:

- бот сохраняет `file_id`, `file_unique_id`, duration, file size и mime type в `club_media`;
- для voice/audio/video_note/video создается job;
- worker скачивает файл в Docker volume;
- ошибки скачивания ретраятся;
- транскрибация сохраняет raw и clean transcript;
- локальные аудиофайлы удаляются по retention;
- Telegram update handler не блокируется скачиванием или транскрибацией.
