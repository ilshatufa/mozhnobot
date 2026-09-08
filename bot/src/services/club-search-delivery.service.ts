import { type Telegram } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubMessageIndexRepository } from "../repositories/club-message-index.repository.js";
import { clubSearchRequestRepository } from "../repositories/club-search-request.repository.js";
import { isBotBlockedError, isMessageNotModifiedError } from "../telegram-errors.js";
import { eventLoggerService } from "./event-logger.service.js";
import { buildSearchResultText } from "./club-search-result.js";

const DELIVERY_INTERVAL_MS = 2_000;

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
        const sourceMessages = await clubMessageIndexRepository.findPreviewsByTelegramMessageIds(
          BigInt(config.clubGroupId),
          request.sourceMessageIds,
        );
        await telegram.editMessageText(
          request.telegramChatId.toString(),
          request.progressMessageId,
          undefined,
          buildSearchResultText(request, sourceMessages, config.clubGroupId),
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          },
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
