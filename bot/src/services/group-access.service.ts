import type { User } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { userRepository } from "../repositories/user.repository.js";

type TelegramUserLike = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type ChatMemberLike = {
  status: string;
  is_member?: boolean;
  user: TelegramUserLike;
};

export type ChatMemberUpdateLike = {
  chat: { id: number };
  date: number;
  old_chat_member: ChatMemberLike;
  new_chat_member: ChatMemberLike;
};

export type GroupAccessTelegram = {
  getChatMember(
    chatId: string | number,
    userId: number,
  ): Promise<{ status: string; is_member?: boolean }>;
  unbanChatMember(
    chatId: string | number,
    userId: number,
    extra?: { only_if_banned?: boolean },
  ): Promise<boolean>;
};

export type GroupAccessUser = Pick<
  User,
  "telegramId" | "username" | "groupRemovalExempt" | "clearAccessGroupAt"
>;

export interface GroupAccessRepository {
  findByTelegramId(telegramId: bigint): Promise<GroupAccessUser | null>;
  upsertFromTelegramUser(user: TelegramUserLike, seenAt: Date): Promise<GroupAccessUser>;
  scheduleGroupAccessClearance(telegramId: bigint, clearAt: Date): Promise<boolean>;
  clearGroupAccessClearance(telegramId: bigint): Promise<void>;
  findDueGroupAccessClearances(now: Date, limit?: number): Promise<GroupAccessUser[]>;
}

export type GroupAccessSettings = {
  enabled: boolean;
  sourceChatId: string;
  managedChatIds: readonly string[];
  graceHours: number;
  dueIntervalMs: number;
};

function isMemberPresent(member: { status: string; is_member?: boolean }): boolean {
  return (
    ["member", "administrator", "creator"].includes(member.status) ||
    (member.status === "restricted" && member.is_member === true)
  );
}

function isMemberAbsent(member: { status: string; is_member?: boolean }): boolean {
  return (
    ["left", "kicked"].includes(member.status) ||
    (member.status === "restricted" && member.is_member === false)
  );
}

function isMemberNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("response" in error)) return false;

  const response = (error as {
    response?: { error_code?: number; description?: string };
  }).response;

  return response?.error_code === 400 && response.description?.endsWith("member not found") === true;
}

async function getSourceMember(
  telegram: GroupAccessTelegram,
  sourceChatId: string,
  userId: number,
): Promise<{ status: string; is_member?: boolean }> {
  try {
    return await telegram.getChatMember(sourceChatId, userId);
  } catch (error) {
    if (isMemberNotFoundError(error)) return { status: "left" };
    throw error;
  }
}

export function isJoinTransition(update: ChatMemberUpdateLike): boolean {
  return isMemberAbsent(update.old_chat_member) && isMemberPresent(update.new_chat_member);
}

export function isLeaveTransition(update: ChatMemberUpdateLike): boolean {
  return isMemberPresent(update.old_chat_member) && isMemberAbsent(update.new_chat_member);
}

function toTelegramUserId(telegramId: bigint): number {
  const value = Number(telegramId);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Telegram user id is outside the safe integer range: ${telegramId}`);
  }
  return value;
}

export class GroupAccessService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: GroupAccessRepository = userRepository,
    private readonly settings: GroupAccessSettings = {
      enabled: config.groupAccess.enabled,
      sourceChatId: config.clubGroupId,
      managedChatIds: config.groupAccess.managedChatIds,
      graceHours: config.groupAccess.graceHours,
      dueIntervalMs: config.groupAccess.dueIntervalMs,
    },
  ) {}

  async handleChatMember(update: ChatMemberUpdateLike, telegram: GroupAccessTelegram): Promise<void> {
    if (!this.settings.enabled || update.new_chat_member.user.is_bot) return;

    const chatId = String(update.chat.id);
    const user = update.new_chat_member.user;
    const telegramId = BigInt(user.id);
    const occurredAt = new Date(update.date * 1000);

    if (chatId === this.settings.sourceChatId) {
      await this.repository.upsertFromTelegramUser(user, occurredAt);

      if (isLeaveTransition(update)) {
        const clearAt = new Date(
          occurredAt.getTime() + this.settings.graceHours * 60 * 60 * 1000,
        );
        const scheduled = await this.repository.scheduleGroupAccessClearance(telegramId, clearAt);
        logger.info("Group access clearance scheduled", {
          telegramId: telegramId.toString(),
          clearAt: clearAt.toISOString(),
          scheduled,
        });
      } else if (isJoinTransition(update)) {
        await this.repository.clearGroupAccessClearance(telegramId);
        logger.info("Group access clearance cancelled after club rejoin", {
          telegramId: telegramId.toString(),
        });
      }
      return;
    }

    if (!this.settings.managedChatIds.includes(chatId) || !isJoinTransition(update)) return;

    const dbUser = await this.repository.upsertFromTelegramUser(user, occurredAt);
    if (dbUser.groupRemovalExempt) {
      logger.info("Managed group entrant is exempt from membership enforcement", {
        telegramId: telegramId.toString(),
        chatId,
      });
      return;
    }

    try {
      const sourceMember = await getSourceMember(telegram, this.settings.sourceChatId, user.id);
      if (isMemberPresent(sourceMember)) {
        await this.repository.clearGroupAccessClearance(telegramId);
        return;
      }
      if (!isMemberAbsent(sourceMember)) {
        throw new Error(`Unsupported source membership status: ${sourceMember.status}`);
      }
    } catch (error) {
      await this.repository.scheduleGroupAccessClearance(telegramId, occurredAt);
      logger.error("Failed to verify managed group entrant; queued for retry", {
        telegramId: telegramId.toString(),
        chatId,
        error,
      });
      return;
    }

    try {
      await this.removeFromManagedGroup(telegram, chatId, telegramId);
    } catch (error) {
      await this.repository.scheduleGroupAccessClearance(telegramId, occurredAt);
      logger.error("Failed to remove invalid managed group entrant; queued for retry", {
        telegramId: telegramId.toString(),
        chatId,
        error,
      });
    }
  }

  start(telegram: GroupAccessTelegram): void {
    if (!this.settings.enabled || this.timer) return;

    void this.processDue(telegram);
    this.timer = setInterval(() => {
      void this.processDue(telegram);
    }, this.settings.dueIntervalMs);

    logger.info("Group access enforcement started", {
      sourceChatId: this.settings.sourceChatId,
      managedChatIds: this.settings.managedChatIds,
      graceHours: this.settings.graceHours,
      dueIntervalMs: this.settings.dueIntervalMs,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processDue(telegram: GroupAccessTelegram, now = new Date()): Promise<void> {
    if (!this.settings.enabled || this.running) return;
    this.running = true;

    try {
      const users = await this.repository.findDueGroupAccessClearances(now);
      for (const user of users) {
        await this.processDueUser(telegram, user);
      }
    } catch (error) {
      logger.error("Failed to process due group access clearances", error);
    } finally {
      this.running = false;
    }
  }

  private async processDueUser(
    telegram: GroupAccessTelegram,
    user: GroupAccessUser,
  ): Promise<void> {
    if (user.groupRemovalExempt) {
      await this.repository.clearGroupAccessClearance(user.telegramId);
      return;
    }

    const userId = toTelegramUserId(user.telegramId);
    try {
      const sourceMember = await getSourceMember(telegram, this.settings.sourceChatId, userId);
      if (isMemberPresent(sourceMember)) {
        await this.repository.clearGroupAccessClearance(user.telegramId);
        logger.info("Due group access clearance cancelled; user is back in club", {
          telegramId: user.telegramId.toString(),
        });
        return;
      }
      if (!isMemberAbsent(sourceMember)) {
        throw new Error(`Unsupported source membership status: ${sourceMember.status}`);
      }

      for (const chatId of this.settings.managedChatIds) {
        await this.removeFromManagedGroup(telegram, chatId, user.telegramId);
      }

      await this.repository.clearGroupAccessClearance(user.telegramId);
      logger.info("Due group access clearance completed", {
        telegramId: user.telegramId.toString(),
        managedChatIds: this.settings.managedChatIds,
      });
    } catch (error) {
      logger.error("Due group access clearance failed; it will be retried", {
        telegramId: user.telegramId.toString(),
        error,
      });
    }
  }

  private async removeFromManagedGroup(
    telegram: GroupAccessTelegram,
    chatId: string,
    telegramId: bigint,
  ): Promise<void> {
    const userId = toTelegramUserId(telegramId);
    await telegram.unbanChatMember(chatId, userId, { only_if_banned: false });
    logger.info("User removed from managed group with rejoin allowed", {
      telegramId: telegramId.toString(),
      chatId,
    });
  }
}

export const groupAccessService = new GroupAccessService();
