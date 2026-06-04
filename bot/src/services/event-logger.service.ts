import { ClubMembershipStatus, ClubTopicStatus, MediaProcessingStatus, Prisma } from "@prisma/client";
import { type Context } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";
import { clubMediaRepository, type ClubMediaInput } from "../repositories/club-media.repository.js";
import { clubMessageIndexRepository } from "../repositories/club-message-index.repository.js";
import { clubTopicRepository } from "../repositories/club-topic.repository.js";
import { botSettingRepository } from "../repositories/bot-setting.repository.js";
import { mediaProcessingJobRepository } from "../repositories/media-processing-job.repository.js";
import { userRepository } from "../repositories/user.repository.js";

type TelegramUserLike = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChatLike = {
  id: number;
  type?: string;
};

type TelegramMessageLike = {
  message_id: number;
  message_thread_id?: number;
  date: number;
  edit_date?: number;
  from?: TelegramUserLike;
  chat: TelegramChatLike;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessageLike;
  forum_topic_created?: {
    name: string;
  };
  forum_topic_edited?: {
    name?: string;
  };
  forum_topic_closed?: Record<string, never>;
  forum_topic_reopened?: Record<string, never>;
  general_forum_topic_hidden?: Record<string, never>;
  general_forum_topic_unhidden?: Record<string, never>;
  new_chat_members?: TelegramUserLike[];
  left_chat_member?: TelegramUserLike;
  photo?: unknown;
  video?: {
    file_id: string;
    file_unique_id?: string;
    duration?: number;
    mime_type?: string;
    file_size?: number;
  };
  voice?: {
    file_id: string;
    file_unique_id?: string;
    duration?: number;
    mime_type?: string;
    file_size?: number;
  };
  document?: unknown;
  sticker?: unknown;
  audio?: {
    file_id: string;
    file_unique_id?: string;
    duration?: number;
    mime_type?: string;
    file_size?: number;
    title?: string;
    performer?: string;
  };
  animation?: unknown;
  video_note?: {
    file_id: string;
    file_unique_id?: string;
    duration?: number;
    file_size?: number;
  };
};

type ChatMemberUpdateLike = {
  chat: TelegramChatLike;
  from: TelegramUserLike;
  date: number;
  old_chat_member: { status: string; user: TelegramUserLike };
  new_chat_member: { status: string; user: TelegramUserLike };
};

type ChatJoinRequestLike = {
  chat: TelegramChatLike;
  from: TelegramUserLike;
  date: number;
};

type MessageReactionUpdateLike = {
  chat: TelegramChatLike;
  message_id: number;
  user?: TelegramUserLike;
  date: number;
  old_reaction?: unknown[];
  new_reaction?: unknown[];
};

type MessageReactionCountUpdateLike = {
  chat: TelegramChatLike;
  message_id: number;
  date: number;
  reactions?: unknown[];
};

type CallbackQueryLike = {
  id: string;
  from: TelegramUserLike;
  data?: string;
  message?: {
    chat?: TelegramChatLike;
    message_id?: number;
  };
};

type UpdateLike = {
  update_id: number;
  message?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
  chat_member?: ChatMemberUpdateLike;
  my_chat_member?: ChatMemberUpdateLike;
  chat_join_request?: ChatJoinRequestLike;
  message_reaction?: MessageReactionUpdateLike;
  message_reaction_count?: MessageReactionCountUpdateLike;
  callback_query?: CallbackQueryLike;
};

const CLUB_GROUP_ID = BigInt(config.clubGroupId);

function toDate(unixSeconds?: number): Date {
  if (!unixSeconds) return new Date();
  return new Date(unixSeconds * 1000);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  ) as Prisma.InputJsonValue;
}

function isClubChat(chat?: TelegramChatLike): boolean {
  return Boolean(chat && BigInt(chat.id) === CLUB_GROUP_ID);
}

function getMessageType(message: TelegramMessageLike): string {
  if (message.forum_topic_created) return "forum_topic_created";
  if (message.forum_topic_edited) return "forum_topic_edited";
  if (message.forum_topic_closed) return "forum_topic_closed";
  if (message.forum_topic_reopened) return "forum_topic_reopened";
  if (message.general_forum_topic_hidden) return "general_forum_topic_hidden";
  if (message.general_forum_topic_unhidden) return "general_forum_topic_unhidden";
  if (message.new_chat_members) return "new_chat_members";
  if (message.left_chat_member) return "left_chat_member";
  if (message.text) return "text";
  if (message.photo) return "photo";
  if (message.video) return "video";
  if (message.voice) return "voice";
  if (message.document) return "document";
  if (message.sticker) return "sticker";
  if (message.audio) return "audio";
  if (message.animation) return "animation";
  if (message.video_note) return "video_note";
  return "other";
}

function getMediaInput(
  message: TelegramMessageLike,
  messageIndexId: number,
): ClubMediaInput | null {
  const base = {
    messageIndexId,
    chatTelegramId: BigInt(message.chat.id),
    telegramMessageId: message.message_id,
  };

  if (message.voice) {
    return {
      ...base,
      mediaType: "voice",
      telegramFileId: message.voice.file_id,
      telegramFileUniqueId: message.voice.file_unique_id,
      durationSeconds: message.voice.duration,
      fileSize: message.voice.file_size,
      mimeType: message.voice.mime_type,
    };
  }

  if (message.audio) {
    return {
      ...base,
      mediaType: "audio",
      telegramFileId: message.audio.file_id,
      telegramFileUniqueId: message.audio.file_unique_id,
      durationSeconds: message.audio.duration,
      fileSize: message.audio.file_size,
      mimeType: message.audio.mime_type,
      title: message.audio.title,
      performer: message.audio.performer,
    };
  }

  if (message.video_note) {
    return {
      ...base,
      mediaType: "video_note",
      telegramFileId: message.video_note.file_id,
      telegramFileUniqueId: message.video_note.file_unique_id,
      durationSeconds: message.video_note.duration,
      fileSize: message.video_note.file_size,
    };
  }

  if (message.video) {
    return {
      ...base,
      mediaType: "video",
      telegramFileId: message.video.file_id,
      telegramFileUniqueId: message.video.file_unique_id,
      durationSeconds: message.video.duration,
      fileSize: message.video.file_size,
      mimeType: message.video.mime_type,
    };
  }

  return null;
}

function reactionKeys(reactions: unknown[] | undefined): string[] {
  if (!Array.isArray(reactions)) return [];
  return reactions.map((reaction) => JSON.stringify(reaction));
}

function diffReactions(oldReaction: unknown[] | undefined, newReaction: unknown[] | undefined) {
  const oldKeys = new Set(reactionKeys(oldReaction));
  const newKeys = new Set(reactionKeys(newReaction));

  return {
    oldReaction: oldReaction ?? [],
    newReaction: newReaction ?? [],
    added: [...newKeys].filter((reaction) => !oldKeys.has(reaction)).map((reaction) => JSON.parse(reaction)),
    removed: [...oldKeys].filter((reaction) => !newKeys.has(reaction)).map((reaction) => JSON.parse(reaction)),
  };
}

function dedupeKey(updateId: number, eventType: string, suffix?: string): string {
  return suffix ? `${updateId}:${eventType}:${suffix}` : `${updateId}:${eventType}`;
}

export class EventLoggerService {
  async logContext(ctx: Context): Promise<void> {
    const update = ctx.update as UpdateLike;

    if (update.message) {
      await this.logMessage(update.update_id, update.message, false);
    }

    if (update.edited_message) {
      await this.logMessage(update.update_id, update.edited_message, true);
    }

    if (update.message_reaction) {
      await this.logMessageReaction(update.update_id, update.message_reaction);
    }

    if (update.message_reaction_count) {
      await this.logMessageReactionCount(update.update_id, update.message_reaction_count);
    }

    if (update.chat_member) {
      await this.logChatMember(update.update_id, update.chat_member);
    }

    if (update.chat_join_request) {
      await this.logJoinRequest(update.update_id, update.chat_join_request);
    }

    if (update.callback_query) {
      await this.logCallbackQuery(update.update_id, update.callback_query);
    }
  }

  async markBotBlocked(telegramId: bigint, occurredAt = new Date()): Promise<void> {
    await userRepository.markBotBlocked(telegramId, occurredAt);
    await clubEventRepository.createIfNotExists({
      dedupeKey: `bot_blocked:${telegramId}:${occurredAt.getTime()}`,
      eventType: "bot_blocked",
      userTelegramId: telegramId,
      occurredAt,
    });
  }

  private async upsertUser(user: TelegramUserLike, occurredAt: Date) {
    return userRepository.upsertFromTelegramUser(user, occurredAt);
  }

  private async upsertTopicFromMessage(message: TelegramMessageLike): Promise<void> {
    if (!message.message_thread_id || !isClubChat(message.chat)) return;

    const name =
      message.forum_topic_created?.name ??
      message.forum_topic_edited?.name ??
      message.reply_to_message?.forum_topic_created?.name;
    let status: ClubTopicStatus = ClubTopicStatus.ACTIVE;

    if (message.forum_topic_closed) status = ClubTopicStatus.CLOSED;
    if (message.general_forum_topic_hidden) status = ClubTopicStatus.HIDDEN;

    await clubTopicRepository.upsert(BigInt(message.chat.id), message.message_thread_id, {
      name,
      status,
    });
  }

  private async logMessage(updateId: number, message: TelegramMessageLike, edited: boolean): Promise<void> {
    const occurredAt = toDate(edited ? message.edit_date : message.date);

    if (message.chat.type === "private") {
      if (message.from) {
        await this.upsertUser(message.from, occurredAt);
        const previousUser = await userRepository.findByTelegramId(BigInt(message.from.id));
        await userRepository.markBotActive(BigInt(message.from.id), occurredAt);

        if (previousUser?.botStatus === "BLOCKED") {
          await clubEventRepository.createIfNotExists({
            telegramUpdateId: BigInt(updateId),
            dedupeKey: dedupeKey(updateId, "bot_unblocked"),
            eventType: "bot_unblocked",
            userTelegramId: BigInt(message.from.id),
            occurredAt,
          });
        }

        if (message.text?.startsWith("/")) {
          await clubEventRepository.createIfNotExists({
            telegramUpdateId: BigInt(updateId),
            dedupeKey: dedupeKey(updateId, "command_used"),
            eventType: "command_used",
            userTelegramId: BigInt(message.from.id),
            messageTelegramId: message.message_id,
            occurredAt,
            payload: toJson({ command: message.text.split(/\s+/)[0] }),
          });
        }
      }

      return;
    }

    if (!isClubChat(message.chat)) return;

    await this.upsertTopicFromMessage(message);

    const authorTelegramId = message.from ? BigInt(message.from.id) : undefined;
    if (message.from) {
      await this.upsertUser(message.from, occurredAt);
      await userRepository.markMemberIfUnknown(BigInt(message.from.id), occurredAt);
    }

    const messageType = getMessageType(message);
    const messageIndex = await clubMessageIndexRepository.upsert({
      chatTelegramId: BigInt(message.chat.id),
      telegramMessageId: message.message_id,
      telegramMessageThreadId: message.message_thread_id,
      authorTelegramId,
      replyToTelegramMessageId: message.reply_to_message?.message_id,
      messageType,
      text: message.text,
      caption: message.caption,
      postedAt: toDate(message.date),
      editedAt: edited ? occurredAt : undefined,
    });

    const mediaInput = getMediaInput(message, messageIndex.id);
    let mediaJobStatus: MediaProcessingStatus | null = null;
    if (!edited && mediaInput) {
      const media = await clubMediaRepository.upsert(mediaInput);
      const transcriptionEnabled = await botSettingRepository.isTranscriptionEnabled();
      mediaJobStatus = transcriptionEnabled ? MediaProcessingStatus.PENDING : MediaProcessingStatus.DISABLED;
      await mediaProcessingJobRepository.createIfNotExists(media.id, mediaJobStatus);
    }

    await clubEventRepository.createIfNotExists({
      telegramUpdateId: BigInt(updateId),
      dedupeKey: dedupeKey(updateId, edited ? "message_edited" : "message_created"),
      eventType: edited ? "message_edited" : "message_created",
      chatTelegramId: BigInt(message.chat.id),
      telegramMessageThreadId: message.message_thread_id,
      userTelegramId: authorTelegramId,
      messageTelegramId: message.message_id,
      occurredAt,
      payload: toJson({
        messageType,
        hasText: Boolean(message.text),
        hasCaption: Boolean(message.caption),
        textLength: message.text?.length ?? null,
        captionLength: message.caption?.length ?? null,
        hasMediaJob: Boolean(mediaInput),
        mediaJobStatus,
      }),
    });

    if (!edited && message.reply_to_message) {
      const targetMessage = await clubMessageIndexRepository.findByTelegramMessage(
        BigInt(message.chat.id),
        message.reply_to_message.message_id,
      );

      await clubEventRepository.createIfNotExists({
        telegramUpdateId: BigInt(updateId),
        dedupeKey: dedupeKey(updateId, "message_reply_created"),
        eventType: "message_reply_created",
        chatTelegramId: BigInt(message.chat.id),
        telegramMessageThreadId: message.message_thread_id,
        userTelegramId: authorTelegramId,
        messageTelegramId: message.message_id,
        targetUserTelegramId: targetMessage?.authorTelegramId ?? undefined,
        targetMessageTelegramId: message.reply_to_message.message_id,
        occurredAt,
      });
    }

    await this.logMessageServiceEvents(updateId, message, occurredAt);
  }

  private async logMessageServiceEvents(
    updateId: number,
    message: TelegramMessageLike,
    occurredAt: Date,
  ): Promise<void> {
    const chatTelegramId = BigInt(message.chat.id);
    const actorTelegramId = message.from ? BigInt(message.from.id) : undefined;

    if (message.new_chat_members) {
      for (const member of message.new_chat_members) {
        await this.upsertUser(member, occurredAt);
        await userRepository.markClubStatus(BigInt(member.id), ClubMembershipStatus.MEMBER, occurredAt);
        await clubEventRepository.createIfNotExists({
          telegramUpdateId: BigInt(updateId),
          dedupeKey: dedupeKey(updateId, "member_joined", String(member.id)),
          eventType: "member_joined",
          chatTelegramId,
          telegramMessageThreadId: message.message_thread_id,
          userTelegramId: BigInt(member.id),
          targetUserTelegramId: actorTelegramId,
          occurredAt,
        });
      }
    }

    if (message.left_chat_member) {
      await this.upsertUser(message.left_chat_member, occurredAt);
      await userRepository.markClubStatus(
        BigInt(message.left_chat_member.id),
        ClubMembershipStatus.LEFT,
        occurredAt,
      );
      await clubEventRepository.createIfNotExists({
        telegramUpdateId: BigInt(updateId),
        dedupeKey: dedupeKey(updateId, "member_left", String(message.left_chat_member.id)),
        eventType: "member_left",
        chatTelegramId,
        telegramMessageThreadId: message.message_thread_id,
        userTelegramId: BigInt(message.left_chat_member.id),
        targetUserTelegramId: actorTelegramId,
        occurredAt,
      });
    }

    const topicEvents: Array<[keyof TelegramMessageLike, string, ClubTopicStatus | null]> = [
      ["forum_topic_created", "topic_created", ClubTopicStatus.ACTIVE],
      ["forum_topic_edited", "topic_edited", null],
      ["forum_topic_closed", "topic_closed", ClubTopicStatus.CLOSED],
      ["forum_topic_reopened", "topic_reopened", ClubTopicStatus.ACTIVE],
      ["general_forum_topic_hidden", "general_topic_hidden", ClubTopicStatus.HIDDEN],
      ["general_forum_topic_unhidden", "general_topic_unhidden", ClubTopicStatus.ACTIVE],
    ];

    for (const [field, eventType, status] of topicEvents) {
      if (!message[field]) continue;

      if (message.message_thread_id && status) {
        await clubTopicRepository.upsert(chatTelegramId, message.message_thread_id, { status });
      }

      await clubEventRepository.createIfNotExists({
        telegramUpdateId: BigInt(updateId),
        dedupeKey: dedupeKey(updateId, eventType),
        eventType,
        chatTelegramId,
        telegramMessageThreadId: message.message_thread_id,
        userTelegramId: actorTelegramId,
        messageTelegramId: message.message_id,
        occurredAt,
      });
    }
  }

  private async logMessageReaction(
    updateId: number,
    reaction: MessageReactionUpdateLike,
  ): Promise<void> {
    if (!isClubChat(reaction.chat)) return;

    const occurredAt = toDate(reaction.date);
    const userTelegramId = reaction.user ? BigInt(reaction.user.id) : undefined;

    if (reaction.user) {
      await this.upsertUser(reaction.user, occurredAt);
      await userRepository.markMemberIfUnknown(BigInt(reaction.user.id), occurredAt);
      await userRepository.markSeen(BigInt(reaction.user.id), occurredAt);
    }

    const targetMessage = await clubMessageIndexRepository.findByTelegramMessage(
      BigInt(reaction.chat.id),
      reaction.message_id,
    );

    await clubEventRepository.createIfNotExists({
      telegramUpdateId: BigInt(updateId),
      dedupeKey: dedupeKey(updateId, "reaction_changed"),
      eventType: "reaction_changed",
      chatTelegramId: BigInt(reaction.chat.id),
      telegramMessageThreadId: targetMessage?.telegramMessageThreadId ?? undefined,
      userTelegramId,
      targetUserTelegramId: targetMessage?.authorTelegramId ?? undefined,
      targetMessageTelegramId: reaction.message_id,
      occurredAt,
      payload: toJson(diffReactions(reaction.old_reaction, reaction.new_reaction)),
    });
  }

  private async logMessageReactionCount(
    updateId: number,
    reaction: MessageReactionCountUpdateLike,
  ): Promise<void> {
    if (!isClubChat(reaction.chat)) return;

    const targetMessage = await clubMessageIndexRepository.findByTelegramMessage(
      BigInt(reaction.chat.id),
      reaction.message_id,
    );

    await clubEventRepository.createIfNotExists({
      telegramUpdateId: BigInt(updateId),
      dedupeKey: dedupeKey(updateId, "reaction_count_changed"),
      eventType: "reaction_count_changed",
      chatTelegramId: BigInt(reaction.chat.id),
      telegramMessageThreadId: targetMessage?.telegramMessageThreadId ?? undefined,
      targetUserTelegramId: targetMessage?.authorTelegramId ?? undefined,
      targetMessageTelegramId: reaction.message_id,
      occurredAt: toDate(reaction.date),
      payload: toJson({ reactions: reaction.reactions ?? [] }),
    });
  }

  private async logChatMember(updateId: number, memberUpdate: ChatMemberUpdateLike): Promise<void> {
    if (!isClubChat(memberUpdate.chat)) return;

    const occurredAt = toDate(memberUpdate.date);
    const member = memberUpdate.new_chat_member.user;
    const actor = memberUpdate.from;
    const oldStatus = memberUpdate.old_chat_member.status;
    const newStatus = memberUpdate.new_chat_member.status;
    const chatTelegramId = BigInt(memberUpdate.chat.id);

    await this.upsertUser(member, occurredAt);
    await this.upsertUser(actor, occurredAt);

    let eventType = "member_status_changed";
    let clubStatus: ClubMembershipStatus | null = null;

    if (["member", "administrator", "creator"].includes(newStatus)) {
      clubStatus = ClubMembershipStatus.MEMBER;
      eventType = ["left", "kicked"].includes(oldStatus) ? "member_joined" : "member_status_changed";
    } else if (newStatus === "left") {
      clubStatus = ClubMembershipStatus.LEFT;
      eventType = "member_left";
    } else if (newStatus === "kicked") {
      clubStatus = ClubMembershipStatus.REMOVED;
      eventType = "member_removed";
    }

    if (clubStatus) {
      await userRepository.markClubStatus(BigInt(member.id), clubStatus, occurredAt);
    } else {
      await userRepository.markSeen(BigInt(member.id), occurredAt);
    }

    await clubEventRepository.createIfNotExists({
      telegramUpdateId: BigInt(updateId),
      dedupeKey: dedupeKey(updateId, eventType, String(member.id)),
      eventType,
      chatTelegramId,
      userTelegramId: BigInt(member.id),
      targetUserTelegramId: BigInt(actor.id),
      occurredAt,
      payload: toJson({ oldStatus, newStatus }),
    });
  }

  private async logJoinRequest(updateId: number, joinRequest: ChatJoinRequestLike): Promise<void> {
    if (!isClubChat(joinRequest.chat)) return;

    const occurredAt = toDate(joinRequest.date);
    await this.upsertUser(joinRequest.from, occurredAt);
    await userRepository.markClubStatus(
      BigInt(joinRequest.from.id),
      ClubMembershipStatus.JOIN_REQUESTED,
      occurredAt,
    );

    await clubEventRepository.createIfNotExists({
      telegramUpdateId: BigInt(updateId),
      dedupeKey: dedupeKey(updateId, "join_request_created", String(joinRequest.from.id)),
      eventType: "join_request_created",
      chatTelegramId: BigInt(joinRequest.chat.id),
      userTelegramId: BigInt(joinRequest.from.id),
      occurredAt,
    });
  }

  private async logCallbackQuery(updateId: number, callbackQuery: CallbackQueryLike): Promise<void> {
    const occurredAt = new Date();
    await this.upsertUser(callbackQuery.from, occurredAt);
    await userRepository.markBotActive(BigInt(callbackQuery.from.id), occurredAt);

    const chatTelegramId = callbackQuery.message?.chat?.id
      ? BigInt(callbackQuery.message.chat.id)
      : undefined;

    await clubEventRepository.createIfNotExists({
      telegramUpdateId: BigInt(updateId),
      dedupeKey: dedupeKey(updateId, "callback_clicked", callbackQuery.id),
      eventType: "callback_clicked",
      chatTelegramId,
      userTelegramId: BigInt(callbackQuery.from.id),
      messageTelegramId: callbackQuery.message?.message_id,
      occurredAt,
      payload: toJson({ data: callbackQuery.data ?? null }),
    });
  }
}

export const eventLoggerService = new EventLoggerService();
