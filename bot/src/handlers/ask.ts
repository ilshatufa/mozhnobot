import { config } from "../config.js";
import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { clubMessageSearchRepository } from "../repositories/club-message-search.repository.js";
import { formatSearchAnswer } from "../services/ai-search-core.js";
import { ClubAiSearchService } from "../services/ai-search.service.js";

const MAX_QUESTION_LENGTH = 500;
const activeSearches = new Set<number>();

const aiSearchService = new ClubAiSearchService(clubMessageSearchRepository, {
  apiKey: config.aiSearch.openaiApiKey,
  model: config.aiSearch.model,
  timeoutMs: config.aiSearch.timeoutMs,
  maxResults: config.aiSearch.maxResults,
});

export function extractAskQuestion(text: string): string {
  return text.replace(/^\/ask(?:@\w+)?(?:\s+|$)/i, "").trim();
}

async function editSearchMessage(
  ctx: AuthContext,
  messageId: number,
  text: string,
): Promise<void> {
  if (!ctx.chat) throw new Error("AI search response has no target chat");
  await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function askHandler(ctx: AuthContext): Promise<void> {
  const message = ctx.message;
  if (!message || !("text" in message) || !ctx.from) return;

  const question = extractAskQuestion(message.text);
  if (!question) {
    await ctx.reply(
      "Напишите вопрос после команды.\n\nНапример: /ask Кто уже делал ремонт в новостройке?",
    );
    return;
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    await ctx.reply("Сократите вопрос до 500 знаков и отправьте ещё раз.");
    return;
  }
  if (activeSearches.has(ctx.from.id)) {
    await ctx.reply("Предыдущий поиск ещё идёт. Дождитесь ответа.");
    return;
  }

  activeSearches.add(ctx.from.id);
  try {
    const progressMessage = await ctx.reply("Ищу по истории клуба…");

    try {
      const result = await aiSearchService.search(question, BigInt(config.clubGroupId));

      if (result.kind === "too_vague") {
        await editSearchMessage(
          ctx,
          progressMessage.message_id,
          "<b>Уточните вопрос</b>\n\nДобавьте тему, имя или конкретную ситуацию, которую нужно найти.",
        );
        return;
      }
      if (result.kind === "no_matches") {
        await editSearchMessage(
          ctx,
          progressMessage.message_id,
          "<b>По истории клуба</b>\n\nПо этим словам ничего не нашлось.\n\nПопробуйте другую формулировку или добавьте конкретную тему.",
        );
        return;
      }

      await editSearchMessage(
        ctx,
        progressMessage.message_id,
        formatSearchAnswer(result.answer, result.candidates, BigInt(config.clubGroupId)),
      );
    } catch (error) {
      logger.error("AI search failed", { error, telegramUserId: ctx.from.id });
      await editSearchMessage(
        ctx,
        progressMessage.message_id,
        "Сейчас поиск недоступен. Попробуйте ещё раз позже.",
      );
    }
  } finally {
    activeSearches.delete(ctx.from.id);
  }
}
