# ТЗ: MVP бота аналитики событий для Telegram-клуба

Дата: 3 июня 2026  
Проект: клубный Telegram-бот с существующей Prisma-схемой  
Цель: начать фиксировать события клуба без внедрения геймификации в первой версии

## 1. Цель MVP

Добавить в существующего бота слой аналитики, который фиксирует события в клубной Telegram-группе:

- сообщения;
- реакции;
- ответы на сообщения;
- входы, выходы и смену статуса участников;
- заявки на вступление;
- события по подтемам;
- личное взаимодействие пользователя с ботом;
- факт блокировки бота пользователем, если это определяется через ошибку отправки.

MVP не должен начислять очки, строить публичные рейтинги или менять текущую VPN-логику. Первая задача - собрать надежный журнал событий, на основе которого позже можно считать вовлеченность, retention, активность по подтемам и геймификацию.

## 2. Что уже есть в проекте

Текущая Prisma-схема уже содержит:

- enum `Role`;
- таблицу `users`;
- таблицу `vpn_keys`.

Существующие поля нельзя удалять, переименовывать или менять по смыслу.

Текущая `users`:

```prisma
model User {
  id          Int       @id @default(autoincrement())
  telegramId  BigInt    @unique @map("telegram_id")
  username    String?   @db.VarChar(255)
  firstName   String?   @map("first_name") @db.VarChar(255)
  role        Role      @default(USER)
  vpnBlocked  Boolean   @default(false) @map("vpn_blocked")
  isBanned    Boolean   @default(false) @map("is_banned")
  bannedAt    DateTime? @map("banned_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  vpnKeys VpnKey[]

  @@map("users")
}
```

`VpnKey` в рамках MVP аналитики не меняется.

## 3. Правила реализации

- Все команды выполнять только внутри Docker.
- Миграции создавать только через Prisma tooling внутри Docker.
- Не писать и не редактировать SQL миграции вручную.
- После миграции выполнить `prisma generate` внутри Docker.
- После генерации перезапустить сервис бота.
- Хранить полный текст сообщений и caption, если Telegram их передал.
- Не добавлять fallback-логику: неизвестное состояние хранить как `UNKNOWN` или `null`.
- Не ломать существующие команды `/start`, `/vpn`, `/status`, `/users`, `/ban`, `/block` и другие текущие сценарии.

## 4. Telegram update-типы

Бот должен запускаться с явным списком `allowed_updates`:

```json
[
  "message",
  "edited_message",
  "message_reaction",
  "message_reaction_count",
  "chat_member",
  "my_chat_member",
  "chat_join_request",
  "callback_query"
]
```

Важно:

- для реакций и статусов участников бот должен быть администратором группы;
- `message_reaction`, `message_reaction_count`, `chat_member` не нужно считать доступными без явного `allowed_updates`;
- клуб является группой с подтемами, поэтому нужно учитывать `message_thread_id`;
- сообщения без `message_thread_id` должны сохраняться с `telegramMessageThreadId = null`.

## 5. Итоговая MVP-модель

В MVP добавляются только:

1. Новые enum:
   - `ClubMembershipStatus`;
   - `BotInteractionStatus`;
   - `ClubTopicStatus`.
2. Новые поля в существующую `users`.
3. Новые таблицы:
   - `club_topics`;
   - `club_message_index`;
   - `club_events`.

Таблица `club_chats` в MVP не добавляется. Используется `chatTelegramId`, потому что сейчас аналитика нужна для одного клубного чата из `CLUB_GROUP_ID`. Если позже появится несколько клубов/чатов, можно нормализовать модель и добавить `club_chats`.

## 6. Назначение таблиц

### 6.1 `users`

Назначение: справочник Telegram-пользователей и их текущее состояние.

Хранит:

- кто пользователь;
- его роль в боте;
- текущие VPN/ban-флаги;
- состоит ли он в клубе сейчас;
- заблокировал ли он бота;
- когда последний раз был замечен;
- когда писал или реагировал.

Не хранит историю всех действий. История действий хранится в `club_events`.

### 6.2 `club_topics`

Назначение: справочник подтем Telegram-группы.

Нужен, потому что клуб работает как forum-группа с несколькими подтемами. Без этой таблицы аналитика будет видеть только общую активность группы и не сможет показать активность по конкретным темам.

Хранит:

- Telegram ID группы;
- `message_thread_id` подтемы;
- название подтемы;
- текущий статус подтемы.

Позволяет считать:

- живые и неактивные подтемы;
- активность по темам;
- где пишут новички;
- где больше реакций;
- где больше ответов участник-участнику.

### 6.3 `club_message_index`

Назначение: легкий технический индекс сообщений.

В MVP эта таблица также хранит полный текст сообщения и caption, если Telegram их передал. Это нужно для будущего поиска, ручного анализа, AI-аналитики, оценки качества обсуждений и восстановления контекста популярных сообщений.

Таблица нужна, чтобы быстро определить:

- кто автор сообщения;
- в какой подтеме сообщение;
- на какое сообщение оно отвечает;
- на чье сообщение поставили реакцию;
- какой тип сообщения был опубликован.

Без этой таблицы каждую реакцию и каждый ответ пришлось бы восстанавливать из JSON-событий, что усложнит отчеты и будущую геймификацию.

Тексты сообщений хранить только в БД. Не выводить полный текст сообщений в технические логи.

### 6.4 `club_events`

Назначение: неизменяемый журнал всех событий.

Это главная таблица аналитики. Каждое событие пишется как факт: кто, что, где и когда сделал.

Нужна для:

- пересчета аналитики по новым правилам;
- будущих очков и рейтингов;
- retention-отчетов;
- аудита событий;
- защиты от потери исторических данных.

События не редактируются задним числом. Если меняется текущее состояние пользователя или подтемы, обновляется соответствующая таблица и дополнительно пишется новое событие.

## 7. Новые enum

```prisma
enum ClubMembershipStatus {
  UNKNOWN
  JOIN_REQUESTED
  MEMBER
  LEFT
  REMOVED
}

enum BotInteractionStatus {
  UNKNOWN
  ACTIVE
  BLOCKED
}

enum ClubTopicStatus {
  ACTIVE
  CLOSED
  HIDDEN
}
```

### 7.1 `ClubMembershipStatus`

| Значение | Описание |
| --- | --- |
| `UNKNOWN` | Статус пользователя в клубе пока неизвестен |
| `JOIN_REQUESTED` | Пользователь подал заявку на вступление |
| `MEMBER` | Пользователь состоит в клубе |
| `LEFT` | Пользователь вышел из клуба |
| `REMOVED` | Пользователь удален из клуба администратором или забанен |

### 7.2 `BotInteractionStatus`

| Значение | Описание |
| --- | --- |
| `UNKNOWN` | Неизвестно, доступен ли пользователь в личке бота |
| `ACTIVE` | Пользователь писал боту или бот успешно взаимодействовал с ним |
| `BLOCKED` | Пользователь заблокировал бота |

### 7.3 `ClubTopicStatus`

| Значение | Описание |
| --- | --- |
| `ACTIVE` | Подтема активна |
| `CLOSED` | Подтема закрыта |
| `HIDDEN` | Подтема скрыта, актуально для General topic |

## 8. Изменения `users`

Добавить поля поверх существующей модели. Ничего из текущей модели не удалять.

| Prisma-поле | DB-поле | Тип | Default | Назначение |
| --- | --- | --- | --- | --- |
| `lastName` | `last_name` | `String? @db.VarChar(255)` | `null` | Last name из Telegram |
| `isBot` | `is_bot` | `Boolean` | `false` | Является ли пользователь ботом |
| `clubStatus` | `club_status` | `ClubMembershipStatus` | `UNKNOWN` | Текущий статус в клубной группе |
| `joinedAt` | `joined_at` | `DateTime? @db.Timestamptz()` | `null` | Дата последнего вступления |
| `leftAt` | `left_at` | `DateTime? @db.Timestamptz()` | `null` | Дата последнего выхода |
| `botStatus` | `bot_status` | `BotInteractionStatus` | `UNKNOWN` | Состояние личного взаимодействия с ботом |
| `botStartedAt` | `bot_started_at` | `DateTime? @db.Timestamptz()` | `null` | Первое личное взаимодействие с ботом |
| `botBlockedAt` | `bot_blocked_at` | `DateTime? @db.Timestamptz()` | `null` | Когда была зафиксирована блокировка бота |
| `firstSeenAt` | `first_seen_at` | `DateTime? @db.Timestamptz()` | `null` | Первое событие с пользователем |
| `lastSeenAt` | `last_seen_at` | `DateTime? @db.Timestamptz()` | `null` | Последнее событие с пользователем |

Индексы:

```prisma
@@index([clubStatus])
@@index([botStatus])
@@index([lastSeenAt])
```

Разграничение статусов:

- `isBanned` - бан в боте, уже существующее поле;
- `clubStatus = REMOVED` - пользователь удален из Telegram-группы администратором или забанен;
- `vpnBlocked` - запрет на получение VPN;
- `botStatus = BLOCKED` - пользователь заблокировал бота в личных сообщениях.

Эти статусы не подменяют друг друга.

## 9. Таблица `club_topics`

```prisma
model ClubTopic {
  id                      Int      @id @default(autoincrement())
  chatTelegramId          BigInt   @map("chat_telegram_id")
  telegramMessageThreadId Int      @map("telegram_message_thread_id")
  name                    String?  @db.VarChar(255)
  status                  ClubTopicStatus @default(ACTIVE)
  createdAt               DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt               DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([chatTelegramId, telegramMessageThreadId])
  @@index([status])
  @@index([chatTelegramId])
  @@map("club_topics")
}
```

Поля:

| Поле | Назначение |
| --- | --- |
| `chatTelegramId` | Telegram ID клубной группы |
| `telegramMessageThreadId` | ID подтемы из Telegram `message_thread_id` |
| `name` | Название подтемы, если известно |
| `status` | Текущее состояние подтемы |
| `createdAt` | Когда запись создана |
| `updatedAt` | Когда запись обновлена |

Обработка:

- при `forum_topic_created` создать/обновить запись, `status = ACTIVE`;
- при `forum_topic_edited` обновить `name`, если Telegram передал новое название;
- при `forum_topic_closed` поставить `status = CLOSED`;
- при `forum_topic_reopened` поставить `status = ACTIVE`;
- при `general_forum_topic_hidden` поставить `status = HIDDEN`;
- при `general_forum_topic_unhidden` поставить `status = ACTIVE`.

## 10. Таблица `club_message_index`

```prisma
model ClubMessageIndex {
  id                       Int      @id @default(autoincrement())
  chatTelegramId           BigInt   @map("chat_telegram_id")
  telegramMessageId        Int      @map("telegram_message_id")
  telegramMessageThreadId  Int?     @map("telegram_message_thread_id")
  authorTelegramId         BigInt?  @map("author_telegram_id")
  replyToTelegramMessageId Int?     @map("reply_to_telegram_message_id")
  messageType              String   @map("message_type") @db.VarChar(50)
  text                      String?  @db.Text
  caption                   String?  @db.Text
  textLength               Int?     @map("text_length")
  captionLength            Int?     @map("caption_length")
  postedAt                 DateTime @map("posted_at") @db.Timestamptz()
  editedAt                 DateTime? @map("edited_at") @db.Timestamptz()
  createdAt                DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt                DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  @@unique([chatTelegramId, telegramMessageId])
  @@index([authorTelegramId, postedAt])
  @@index([telegramMessageThreadId, postedAt])
  @@index([postedAt])
  @@map("club_message_index")
}
```

Поля:

| Поле | Назначение |
| --- | --- |
| `chatTelegramId` | Telegram ID группы |
| `telegramMessageId` | Telegram `message_id` |
| `telegramMessageThreadId` | Подтема, если сообщение опубликовано в topic |
| `authorTelegramId` | Telegram ID автора, если известен |
| `replyToTelegramMessageId` | Telegram ID сообщения, на которое ответили |
| `messageType` | Тип сообщения: `text`, `photo`, `video`, `voice`, `document`, `sticker`, `service`, etc. |
| `text` | Полный текст сообщения, если есть |
| `caption` | Полный caption медиа-сообщения, если есть |
| `textLength` | Длина `text`, если есть |
| `captionLength` | Длина `caption`, если есть |
| `postedAt` | Время сообщения по Telegram |
| `editedAt` | Время редактирования, если было |

Обработка:

- при новом сообщении делать upsert по `chatTelegramId + telegramMessageId`;
- при редактировании обновлять `editedAt`, `messageType`, `text`, `caption`, `textLength`, `captionLength`, если применимо;
- если сообщение является reply, сохранять `replyToTelegramMessageId`;
- если автор неизвестен, `authorTelegramId = null`, без подстановок.

## 11. Таблица `club_events`

```prisma
model ClubEvent {
  id                      Int      @id @default(autoincrement())
  telegramUpdateId        BigInt?  @map("telegram_update_id")
  dedupeKey               String   @unique @map("dedupe_key") @db.VarChar(255)
  eventType               String   @map("event_type") @db.VarChar(80)
  chatTelegramId          BigInt?  @map("chat_telegram_id")
  telegramMessageThreadId Int?     @map("telegram_message_thread_id")
  userTelegramId          BigInt?  @map("user_telegram_id")
  messageTelegramId       Int?     @map("message_telegram_id")
  targetUserTelegramId    BigInt?  @map("target_user_telegram_id")
  targetMessageTelegramId Int?     @map("target_message_telegram_id")
  occurredAt              DateTime @map("occurred_at") @db.Timestamptz()
  payload                 Json?    @map("payload")
  createdAt               DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([eventType, occurredAt])
  @@index([userTelegramId, occurredAt])
  @@index([chatTelegramId, occurredAt])
  @@index([telegramMessageThreadId, occurredAt])
  @@index([targetUserTelegramId, occurredAt])
  @@index([messageTelegramId])
  @@index([targetMessageTelegramId, occurredAt])
  @@map("club_events")
}
```

Поля:

| Поле | Назначение |
| --- | --- |
| `telegramUpdateId` | Защита от дублей Telegram update |
| `dedupeKey` | Уникальный ключ конкретного внутреннего события |
| `eventType` | Тип события |
| `chatTelegramId` | Telegram ID группы |
| `telegramMessageThreadId` | Подтема события |
| `userTelegramId` | Главный пользователь события |
| `messageTelegramId` | Основное сообщение события |
| `targetUserTelegramId` | Пользователь, на которого направлено действие |
| `targetMessageTelegramId` | Сообщение, на которое направлено действие |
| `occurredAt` | Время события по Telegram |
| `payload` | Детали события в JSON |

`telegramUpdateId` nullable, потому что не все внутренние события обязаны иметь Telegram update id. Один Telegram update может породить несколько внутренних событий, поэтому уникальным должен быть не `telegramUpdateId`, а `dedupeKey`.

Примеры `dedupeKey`:

```text
123456:message_created
123456:message_reply_created
123457:reaction_changed
123458:topic_closed
```

## 12. Типы событий MVP

| eventType | Когда пишется |
| --- | --- |
| `message_created` | Новое сообщение в клубной группе |
| `message_edited` | Сообщение отредактировано |
| `message_reply_created` | Новое сообщение является ответом на другое |
| `reaction_changed` | Пользователь изменил реакцию на сообщение |
| `reaction_count_changed` | Изменилось количество реакций без конкретного пользователя |
| `member_joined` | Пользователь вступил в клуб |
| `member_left` | Пользователь вышел из клуба |
| `member_removed` | Пользователь удален администратором или забанен |
| `member_status_changed` | Прочая смена статуса |
| `join_request_created` | Пользователь подал заявку на вступление |
| `callback_clicked` | Пользователь нажал inline-кнопку |
| `command_used` | Пользователь использовал команду бота |
| `bot_blocked` | Бот зафиксировал, что пользователь его заблокировал |
| `bot_unblocked` | Пользователь снова написал боту после блокировки |
| `topic_created` | Создана подтема |
| `topic_edited` | Изменена подтема |
| `topic_closed` | Подтема закрыта |
| `topic_reopened` | Подтема переоткрыта |
| `general_topic_hidden` | General topic скрыт |
| `general_topic_unhidden` | General topic открыт |

## 13. Логика записи событий

### 13.1 Общий порядок

Для каждого update:

1. Проверить, относится ли update к клубной группе или личному взаимодействию с ботом.
2. Upsert пользователя в `users`, если в update есть Telegram user.
3. Обновить текущие поля пользователя.
4. Если есть `message_thread_id`, upsert подтему в `club_topics`.
5. Если есть сообщение, upsert запись в `club_message_index`.
6. Записать событие в `club_events`.
7. Если `dedupeKey` уже был сохранен, повторно событие не создавать.

### 13.2 Upsert пользователя

При любом событии с пользователем обновлять:

- `telegramId`;
- `username`;
- `firstName`;
- `lastName`;
- `isBot`;
- `firstSeenAt`, если `null`;
- `lastSeenAt`.

Не затирать существующие поля пустыми значениями, если Telegram не передал новое значение.

### 13.3 Личное взаимодействие с ботом

При личном сообщении боту:

- `botStatus = ACTIVE`;
- `botStartedAt = occurredAt`, если `null`;
- если раньше был `botStatus = BLOCKED`, записать `bot_unblocked`;
- записать `command_used`, если это команда.

При ошибке отправки, означающей блокировку бота:

- `botStatus = BLOCKED`;
- `botBlockedAt = occurredAt`, если `null`;
- записать `bot_blocked`.

### 13.4 Членство в клубе

При `chat_join_request`:

- `clubStatus = JOIN_REQUESTED`;
- записать `join_request_created`.

При `chat_member`:

- новый статус `member`, `administrator`, `creator`:
  - `clubStatus = MEMBER`;
  - `joinedAt = occurredAt`;
  - событие `member_joined` или `member_status_changed`;
- новый статус `left`:
  - `clubStatus = LEFT`;
  - `leftAt = occurredAt`;
  - событие `member_left`;
- новый статус `kicked`:
  - `clubStatus = REMOVED`;
  - `leftAt = occurredAt`;
  - событие `member_removed`;
- новый статус `restricted`:
  - `clubStatus` не менять, потому что пользователь остается в клубе;
  - записать `member_status_changed` с деталями ограничения в `payload`.

### 13.5 Сообщения

При `message`:

- сохранить/обновить `club_message_index`;
- определить `messageType`;
- сохранить `text`, `caption`, `textLength`, `captionLength`, если они есть;
- обновить `lastSeenAt` у автора;
- записать `message_created`.

Если сообщение является ответом:

- сохранить `replyToTelegramMessageId`;
- найти исходное сообщение в `club_message_index`;
- если найден автор исходного сообщения, записать `message_reply_created` с `targetUserTelegramId`;
- если автор не найден, записать `targetMessageTelegramId`, а `targetUserTelegramId = null`.

При `edited_message`:

- обновить `editedAt`;
- записать `message_edited`.

### 13.6 Реакции

При `message_reaction`:

- найти целевое сообщение в `club_message_index`;
- если найдено, заполнить `targetUserTelegramId` автором сообщения;
- обновить `lastSeenAt` у пользователя;
- записать `reaction_changed`.

В `payload` сохранить:

- `oldReaction`;
- `newReaction`;
- добавленные реакции;
- удаленные реакции.

При `message_reaction_count`:

- записать `reaction_count_changed`;
- `userTelegramId = null`;
- `targetMessageTelegramId` заполнить по Telegram message_id.

### 13.7 Подтемы

При сообщении с `message_thread_id`:

- убедиться, что запись `club_topics` существует;
- если название неизвестно, оставить `name = null`.

При service-событиях топиков:

- обновить `club_topics.status`;
- обновить `club_topics.name`, если Telegram передал;
- записать соответствующее событие в `club_events`.

## 14. Изменения в коде

Добавить middleware логирования до текущего `authMiddleware`:

```ts
bot.use(eventLoggerMiddleware());
bot.use(authMiddleware());
```

Причина: текущий `authMiddleware` обрабатывает только private message. Групповые события должны логироваться до авторизации приватных команд.

Рекомендуемые файлы:

```text
bot/src/middlewares/event-logger.ts
bot/src/services/event-logger.service.ts
bot/src/repositories/club-topic.repository.ts
bot/src/repositories/club-message-index.repository.ts
bot/src/repositories/club-event.repository.ts
```

Расширить `UserRepository` методами:

- `upsertFromTelegramUser`;
- `markClubStatus`;
- `markBotActive`;
- `markBotBlocked`;
- `markMessageActivity`;
- `markReactionActivity`.

## 15. Минимальные админ-отчеты

В MVP можно добавить одну команду:

```text
/stats
```

Доступ: `ADMIN`.

Отчет за последние 7 дней:

- новые участники;
- ушедшие участники;
- активные участники;
- сообщения;
- реакции;
- ответы участник-участнику;
- топ-5 участников по сообщениям;
- топ-5 подтем по сообщениям;
- участники, вступившие, но не сделавшие ни одного действия.

Команды `/topics` и `/userstats` можно добавить позже, когда накопятся данные.

## 16. Что не входит в MVP

- очки;
- публичный leaderboard;
- streaks;
- бейджи;
- магазин наград;
- Mini App;
- AI-анализ качества сообщений;
- таблица `club_chats`;
- сложные FK-связи между событиями, пользователями и сообщениями;
- автоматическая публикация отчетов в клуб.

## 17. Критерии приемки

MVP готов, если:

- существующие поля `users` и `vpn_keys` сохранены;
- новые поля `users` добавлены миграцией;
- добавлены `club_topics`, `club_message_index`, `club_events`;
- бот пишет события сообщений;
- бот пишет события реакций, если Telegram их присылает;
- бот фиксирует `message_thread_id`;
- бот фиксирует создание/изменение/закрытие/переоткрытие подтем, если Telegram присылает service-событие;
- бот фиксирует входы, выходы, заявки и смену статуса участников;
- бот обновляет `clubStatus`;
- бот обновляет `botStatus`;
- повторная доставка одного события не создает дубль благодаря `dedupeKey`;
- текущие VPN-команды продолжают работать;
- все миграции, generate, сборка и запуск выполнены внутри Docker.
