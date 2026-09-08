import { type Message } from "telegraf/types";
import { type AuthContext } from "../middlewares/auth.js";
import { clubSearchRequestRepository } from "../repositories/club-search-request.repository.js";
import { logger } from "../logger.js";

const MAX_QUESTION_LENGTH = 600;
const MIN_QUESTION_LENGTH = 4;

export function extractSearchQuestion(text: string): string {
  return text.replace(/^\/ask(?:@\w+)?(?:\s+|$)/i, "").trim();
}

export async function clubSearchHandler(ctx: AuthContext): Promise<void> {
  if (!ctx.message || !("text" in ctx.message) || !ctx.from || !ctx.chat) {
    return;
  }

  const question = extractSearchQuestion(ctx.message.text);
  if (question.length < MIN_QUESTION_LENGTH) {
    await ctx.reply(
      "Напишите вопрос после команды.\n\nНапример: /ask Кто уже делал ремонт в новостройке?",
    );
    return;
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    await ctx.reply(`Сократите вопрос до ${MAX_QUESTION_LENGTH} знаков.`);
    return;
  }

  const requesterTelegramId = BigInt(ctx.from.id);
  const activeRequest = await clubSearchRequestRepository.findActiveForRequester(requesterTelegramId);
  if (activeRequest) {
    await ctx.reply("Предыдущий вопрос ещё обрабатывается. Дождитесь ответа и задайте следующий.");
    return;
  }

  const progressMessage = await ctx.reply(
    "Ищу по истории клуба. Обычно это занимает до минуты.",
  ) as Message.TextMessage;

  try {
    await clubSearchRequestRepository.create({
      requesterTelegramId,
      telegramChatId: BigInt(ctx.chat.id),
      progressMessageId: progressMessage.message_id,
      question,
    });
  } catch (error) {
    if (clubSearchRequestRepository.isActiveKeyConflict(error)) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessage.message_id,
        undefined,
        "Предыдущий вопрос ещё обрабатывается. Дождитесь ответа и задайте следующий.",
      );
      return;
    }

    logger.error("Failed to enqueue club search request", {
      requesterTelegramId: requesterTelegramId.toString(),
      error,
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMessage.message_id,
      undefined,
      "Сейчас поиск недоступен. Попробуйте ещё раз позже.",
    );
  }
}
