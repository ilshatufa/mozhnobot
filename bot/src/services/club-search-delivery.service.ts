import { type Telegram } from "telegraf";
import { ClubSearchRequestStatus, type ClubSearchRequest } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubSearchRequestRepository } from "../repositories/club-search-request.repository.js";
import { isBotBlockedError, isMessageNotModifiedError } from "../telegram-errors.js";
import { eventLoggerService } from "./event-logger.service.js";

const DELIVERY_INTERVAL_MS = 2_000;
const MAX_TELEGRAM_TEXT_LENGTH = 4_096;

function sourceLink(messageId: number): string {
  const internalChatId = config.clubGroupId.replace(/^-100/, "");
  return `https://t.me/c/${internalChatId}/${messageId}`;
}

export function buildSearchResultText(request: ClubSearchRequest): string {
  if (request.status === ClubSearchRequestStatus.FAILED) {
    return "Сейчас поиск недоступен. Попробуйте ещё раз позже.";
  }

  const answer = request.answer?.trim();
  if (!answer) {
    return "По истории клуба не нашлось достаточно данных для ответа. Попробуйте добавить тему, имя или конкретный пример.";
  }

  const uniqueSourceIds = [...new Set(request.sourceMessageIds)].slice(0, 8);
  if (uniqueSourceIds.length === 0) {
    return answer.slice(0, MAX_TELEGRAM_TEXT_LENGTH);
  }

  const sources = uniqueSourceIds.map((messageId, index) => `${index + 1}. ${sourceLink(messageId)}`);
  const suffix = `\n\nИсточники:\n${sources.join("\n")}`;
  const answerLimit = MAX_TELEGRAM_TEXT_LENGTH - suffix.length;
  return `${answer.slice(0, Math.max(0, answerLimit))}${suffix}`;
}

export class ClubSearchDeliveryService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(telegram: Telegram): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick(telegram);
    }, DELIVERY_INTERVAL_MS);
    this.timer.unref();
    void this.tick(telegram);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(telegram: Telegram): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.updateProgress(telegram);
      await this.deliverReady(telegram);
    } catch (error) {
      logger.error("Club search delivery tick failed", { error });
    } finally {
      this.running = false;
    }
  }

  private async updateProgress(telegram: Telegram): Promise<void> {
    const requests = await clubSearchRequestRepository.findWaitingForProgress();
    for (const request of requests) {
      try {
        await telegram.editMessageText(
          request.telegramChatId.toString(),
          request.progressMessageId,
          undefined,
          "Просматриваю подходящие обсуждения и сверяю контекст…",
        );
        await clubSearchRequestRepository.markProgressUpdated(request.id);
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          await clubSearchRequestRepository.markProgressUpdated(request.id);
        } else if (!isBotBlockedError(error)) {
          logger.warn("Failed to update club search progress", { requestId: request.id, error });
        }
      }
    }
  }

  private async deliverReady(telegram: Telegram): Promise<void> {
    const requests = await clubSearchRequestRepository.findReadyForDelivery();
    for (const request of requests) {
      try {
        await telegram.editMessageText(
          request.telegramChatId.toString(),
          request.progressMessageId,
          undefined,
          buildSearchResultText(request),
          { link_preview_options: { is_disabled: true } },
        );
        await clubSearchRequestRepository.markDelivered(request.id);
      } catch (error) {
        if (isMessageNotModifiedError(error)) {
          await clubSearchRequestRepository.markDelivered(request.id);
          continue;
        }
        if (isBotBlockedError(error)) {
          await eventLoggerService.markBotBlocked(request.requesterTelegramId);
          await clubSearchRequestRepository.markDelivered(request.id);
          continue;
        }
        logger.warn("Failed to deliver club search result", { requestId: request.id, error });
      }
    }
  }
}

export const clubSearchDeliveryService = new ClubSearchDeliveryService();
