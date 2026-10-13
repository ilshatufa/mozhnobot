import { ClubSearchRequestMode, type ClubSearchRequest } from "@prisma/client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubMessageSearchRepository } from "../repositories/club-message-search.repository.js";
import { clubSearchRequestRepository } from "../repositories/club-search-request.repository.js";
import { QwenWebSearchService } from "./qwen-web-search.service.js";
import { extractSearchTerms, searchQuestionGuidance } from "./search-query.js";

const CLUB_SEARCH_RESULT_LIMIT = 8;
const QUESTION_REQUIRED_CODE = "QUESTION_REQUIRED";

function processingErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "SEARCH_TIMEOUT";
  if (error instanceof Error && error.message.includes("no verifiable sources")) {
    return "NO_WEB_SOURCES";
  }
  if (error instanceof Error && error.message.includes("not configured")) {
    return "SEARCH_NOT_CONFIGURED";
  }
  return "SEARCH_FAILED";
}

export class ClubSearchProcessorService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly webSearch = new QwenWebSearchService({
    apiKey: config.search.qwenApiKey,
    baseUrl: config.search.qwenBaseUrl,
    model: config.search.qwenModel,
    timeoutMs: config.search.timeoutMs,
  });

  async start(): Promise<void> {
    if (!config.search.processingEnabled || this.timer) return;
    const recovered = await clubSearchRequestRepository.failStaleProcessing(
      new Date(Date.now() - config.search.staleMs),
    );
    if (recovered > 0) logger.warn("Failed stale club search requests", { count: recovered });

    this.timer = setInterval(() => {
      void this.tick();
    }, config.search.intervalMs);
    this.timer.unref();
    logger.info("Club search processor started", {
      intervalMs: config.search.intervalMs,
      webModel: config.search.qwenModel,
    });
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const request = await clubSearchRequestRepository.claimNextPending();
      if (request) await this.process(request);
    } catch (error) {
      logger.error("Club search processor tick failed", { error });
    } finally {
      this.running = false;
    }
  }

  private async process(request: ClubSearchRequest): Promise<void> {
    try {
      const mode = request.mode === ClubSearchRequestMode.WEB ? "web" : "club";
      const guidance = searchQuestionGuidance(request.question, mode);
      if (guidance) {
        await clubSearchRequestRepository.complete(request.id, {
          answer: guidance,
          resultCode: QUESTION_REQUIRED_CODE,
        });
        return;
      }

      if (request.mode === ClubSearchRequestMode.WEB) {
        const result = await this.webSearch.search(request.question);
        await clubSearchRequestRepository.complete(request.id, {
          answer: result.answer,
          webSources: result.sources,
        });
        return;
      }

      const terms = extractSearchTerms(request.question);
      const candidates = await clubMessageSearchRepository.search(
        BigInt(config.clubGroupId),
        terms,
        CLUB_SEARCH_RESULT_LIMIT,
      );
      await clubSearchRequestRepository.complete(request.id, {
        answer: candidates.length > 0
          ? "Нашёл сообщения, в которых участники клуба обсуждали эту тему."
          : null,
        sourceMessageIds: candidates.map((candidate) => candidate.telegramMessageId),
      });
    } catch (error) {
      const errorCode = processingErrorCode(error);
      await clubSearchRequestRepository.fail(request.id, errorCode);
      logger.error("Club search request failed", {
        requestId: request.id,
        mode: request.mode,
        errorCode,
        error,
      });
    }
  }
}

export const clubSearchProcessorService = new ClubSearchProcessorService();
