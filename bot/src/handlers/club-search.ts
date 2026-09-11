import { ClubSearchRequestMode } from "@prisma/client";
import { type Message } from "telegraf/types";
import { type AuthContext } from "../middlewares/auth.js";
import { clubSearchRequestRepository } from "../repositories/club-search-request.repository.js";
import { logger } from "../logger.js";

const MAX_QUESTION_LENGTH = 600;
const MIN_QUESTION_LENGTH = 4;

type SearchCommand = "ask" | "web";

type SearchModeOptions = {
  command: SearchCommand;
  mode: ClubSearchRequestMode;
  missingQuestionExample: string;
  progressText: string;
  estimatedTimeText: string;
};

export function extractSearchQuestion(text: string, command: SearchCommand = "ask"): string {
  return text.replace(new RegExp(`^/${command}(?:@\\w+)?(?:\\s+|$)`, "i"), "").trim();
}

export function extractSearchQuestionFromMessage(
  message: Message.TextMessage,
  command: SearchCommand = "ask",
): string {
  const explicitQuestion = extractSearchQuestion(message.text, command);
  if (explicitQuestion) return explicitQuestion;

  const repliedMessage = message.reply_to_message;
  if (!repliedMessage) return "";
  if ("text" in repliedMessage) return repliedMessage.text.trim();
  if ("caption" in repliedMessage && repliedMessage.caption) {
    return repliedMessage.caption.trim();
  }
  return "";
}

function topicReplyOptions(message: Message.TextMessage): { message_thread_id: number } | undefined {
  return message.message_thread_id
    ? { message_thread_id: message.message_thread_id }
    : undefined;
}

async function searchHandler(ctx: AuthContext, options: SearchModeOptions): Promise<void> {
  if (!ctx.message || !("text" in ctx.message) || !ctx.from || !ctx.chat) {
    return;
  }

  const question = extractSearchQuestionFromMessage(ctx.message, options.command);
  const replyOptions = topicReplyOptions(ctx.message);
  if (question.length < MIN_QUESTION_LENGTH) {
    await ctx.reply(
      `Напишите вопрос после команды или ответьте командой на сообщение.\n\nНапример: ${options.missingQuestionExample}`,
      replyOptions,
    );
    return;
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    await ctx.reply(`Сократите вопрос до ${MAX_QUESTION_LENGTH} знаков.`, replyOptions);
    return;
  }

  const requesterTelegramId = BigInt(ctx.from.id);
  const activeRequest = await clubSearchRequestRepository.findActiveForRequester(requesterTelegramId);
  if (activeRequest) {
    await ctx.reply(
      "Предыдущий поиск ещё выполняется. Дождитесь ответа и задайте следующий вопрос.",
      replyOptions,
    );
    return;
  }

  const progressMessage = await ctx.reply(
    `${options.progressText}\n\n«${question}»\n\n${options.estimatedTimeText}`,
    replyOptions,
  ) as Message.TextMessage;

  try {
    await clubSearchRequestRepository.create({
      requesterTelegramId,
      telegramChatId: BigInt(ctx.chat.id),
      progressMessageId: progressMessage.message_id,
      question,
      mode: options.mode,
    });
  } catch (error) {
    if (clubSearchRequestRepository.isActiveKeyConflict(error)) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessage.message_id,
        undefined,
        "Предыдущий поиск ещё выполняется. Дождитесь ответа и задайте следующий вопрос.",
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

export async function clubSearchHandler(ctx: AuthContext): Promise<void> {
  await searchHandler(ctx, {
    command: "ask",
    mode: ClubSearchRequestMode.CLUB,
    missingQuestionExample: "/ask Кто уже делал ремонт в новостройке?",
    progressText: "Ищу в истории клуба.",
    estimatedTimeText: "Обычно это занимает до минуты.",
  });
}

export async function webSearchHandler(ctx: AuthContext): Promise<void> {
  await searchHandler(ctx, {
    command: "web",
    mode: ClubSearchRequestMode.WEB,
    missingQuestionExample: "/web Какие сейчас ставки по вкладам?",
    progressText: "Ищу в интернете.",
    estimatedTimeText: "Это может занять пару минут.",
  });
}
