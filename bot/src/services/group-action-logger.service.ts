import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Telegram } from "telegraf";
import { logger } from "../logger.js";
import {
  clubEventRepository,
  type ClubEventInput,
  type ClubEventRepository,
} from "../repositories/club-event.repository.js";

type GroupActionRepository = Pick<ClubEventRepository, "createIfNotExists">;

type TelegramErrorResponse = {
  response?: {
    error_code?: unknown;
    description?: unknown;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function telegramId(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function groupChatId(payload: unknown): bigint | null {
  const chatId = telegramId(asRecord(payload)?.chat_id);
  return chatId !== undefined && chatId < 0n ? chatId : null;
}

function isActiveMethod(method: string): boolean {
  return !method.startsWith("get");
}

function errorDetails(error: unknown): { errorCode?: number; errorDescription?: string } {
  if (typeof error !== "object" || error === null) return {};
  const response = (error as TelegramErrorResponse).response;
  return {
    errorCode: integer(response?.error_code),
    errorDescription: typeof response?.description === "string"
      ? response.description
      : undefined,
  };
}

function resultMessageId(result: unknown): number | undefined {
  return integer(asRecord(result)?.message_id);
}

function actionEvent(
  actionId: string,
  method: string,
  payload: unknown,
  status: "succeeded" | "failed",
  result?: unknown,
  error?: unknown,
): ClubEventInput {
  const params = asRecord(payload);
  const chatTelegramId = groupChatId(payload);
  if (chatTelegramId === null) {
    throw new Error("Group action event requires a group chat id");
  }

  const targetUserTelegramId = telegramId(params?.user_id);
  const sourceChatTelegramId = telegramId(params?.from_chat_id);
  const sourceMessageId = integer(params?.message_id);
  const sentMessageId = resultMessageId(result);
  const details = errorDetails(error);
  const eventPayload: Prisma.InputJsonObject = {
    actionId,
    method,
    status,
    ...(sourceChatTelegramId !== undefined
      ? { sourceChatTelegramId: sourceChatTelegramId.toString() }
      : {}),
    ...(sourceMessageId !== undefined ? { sourceMessageId } : {}),
    ...(sentMessageId !== undefined ? { resultMessageId: sentMessageId } : {}),
    ...(details.errorCode !== undefined ? { errorCode: details.errorCode } : {}),
    ...(details.errorDescription !== undefined
      ? { errorDescription: details.errorDescription }
      : {}),
  };

  return {
    dedupeKey: `bot_group_action:${actionId}`,
    eventType: `bot_group_action_${status}`,
    chatTelegramId,
    telegramMessageThreadId: integer(params?.message_thread_id),
    messageTelegramId: sentMessageId,
    targetUserTelegramId,
    targetMessageTelegramId: sourceMessageId,
    occurredAt: new Date(),
    payload: eventPayload,
  };
}

async function persistAction(
  repository: GroupActionRepository,
  event: ClubEventInput,
): Promise<void> {
  try {
    await repository.createIfNotExists(event);
  } catch (error) {
    logger.error("Failed to persist bot group action", {
      method: (event.payload as Record<string, unknown> | undefined)?.method,
      chatId: event.chatTelegramId?.toString(),
      error,
    });
  }
}

export function installGroupActionLogging(
  telegram: Telegram,
  repository: GroupActionRepository = clubEventRepository,
): void {
  const originalCallApi = telegram.callApi.bind(telegram);

  telegram.callApi = (async (
    method: string,
    payload: unknown,
    options?: unknown,
  ) => {
    const chatId = groupChatId(payload);
    if (chatId === null || !isActiveMethod(method)) {
      return originalCallApi(method as never, payload as never, options as never);
    }

    const actionId = randomUUID();
    try {
      const result = await originalCallApi(method as never, payload as never, options as never);
      await persistAction(
        repository,
        actionEvent(actionId, method, payload, "succeeded", result),
      );
      logger.info("Bot group action completed", {
        actionId,
        method,
        chatId: chatId.toString(),
      });
      return result;
    } catch (error) {
      await persistAction(
        repository,
        actionEvent(actionId, method, payload, "failed", undefined, error),
      );
      logger.error("Bot group action failed", {
        actionId,
        method,
        chatId: chatId.toString(),
        ...errorDetails(error),
      });
      throw error;
    }
  }) as Telegram["callApi"];
}
