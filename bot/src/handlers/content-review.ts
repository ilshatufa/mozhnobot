import { type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { type AuthContext } from "../middlewares/auth.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";

type ReviewAction = "approve" | "edit";

type ContentReview = {
  id: string;
  ownerTelegramId: number;
  sourceMessageId: number;
  targetThreadId: number;
  correctionPrompt: string;
};

const REVIEWS: Record<string, ContentReview> = {
  "skripko-budget-v1": {
    id: "skripko-budget-v1",
    ownerTelegramId: 301474421,
    sourceMessageId: 4135,
    targetThreadId: 6542,
    correctionPrompt: "✏️ Что исправить в посте «Бюджетный крах за углом?»",
  },
};

export const CONTENT_REVIEW_ACTION_PATTERN = /^review:([a-z0-9-]+):(approve|edit)$/;

function callbackData(ctx: AuthContext): string | null {
  const query = ctx.callbackQuery;
  return query && "data" in query ? query.data : null;
}

function callbackMessage(ctx: AuthContext) {
  const query = ctx.callbackQuery;
  return query && "message" in query ? query.message : undefined;
}

async function answer(ctx: AuthContext, text: string, showAlert = false): Promise<void> {
  await ctx.answerCbQuery(text, { show_alert: showAlert });
}

export async function contentReviewActionHandler(ctx: AuthContext): Promise<void> {
  const data = callbackData(ctx);
  const match = data?.match(CONTENT_REVIEW_ACTION_PATTERN);
  const message = callbackMessage(ctx);
  const review = match ? REVIEWS[match[1]] : undefined;
  const action = match?.[2] as ReviewAction | undefined;

  if (
    !review ||
    !action ||
    !message ||
    ctx.from?.id !== review.ownerTelegramId ||
    message.chat.id !== review.ownerTelegramId ||
    message.chat.type !== "private" ||
    message.message_id !== review.sourceMessageId
  ) {
    await answer(ctx, "Эта карточка не может публиковать пост.", true);
    return;
  }

  if (action === "edit") {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await answer(ctx, "Жду правки ответом на сообщение.");
    await ctx.reply(review.correctionPrompt, {
      reply_parameters: { message_id: review.sourceMessageId },
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Напишите правку",
      },
    });
    return;
  }

  const publishedKey = `content_review_published:${review.id}`;
  const attemptedKey = `content_review_publish_attempted:${review.id}`;
  const published = await clubEventRepository.findByDedupeKey(publishedKey);

  if (published) {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await answer(ctx, "Этот пост уже опубликован.");
    return;
  }

  const attempt = await clubEventRepository.createIfNotExists({
    telegramUpdateId: BigInt(ctx.update.update_id),
    dedupeKey: attemptedKey,
    eventType: "content_review_publish_attempted",
    chatTelegramId: BigInt(review.ownerTelegramId),
    userTelegramId: BigInt(ctx.from.id),
    messageTelegramId: review.sourceMessageId,
    occurredAt: new Date(),
    payload: {
      reviewId: review.id,
      targetChatTelegramId: config.clubGroupId,
      targetMessageThreadId: review.targetThreadId,
    },
  });

  if (!attempt) {
    await answer(
      ctx,
      "Первая попытка уже запускалась. Повторно не публикую, чтобы не создать дубль.",
      true,
    );
    return;
  }

  try {
    const result = await ctx.telegram.copyMessage(
      config.clubGroupId,
      review.ownerTelegramId,
      review.sourceMessageId,
      { message_thread_id: review.targetThreadId },
    );

    await clubEventRepository.createIfNotExists({
      dedupeKey: publishedKey,
      eventType: "content_review_published",
      chatTelegramId: BigInt(config.clubGroupId),
      telegramMessageThreadId: review.targetThreadId,
      userTelegramId: BigInt(ctx.from.id),
      messageTelegramId: result.message_id,
      targetMessageTelegramId: review.sourceMessageId,
      occurredAt: new Date(),
      payload: { reviewId: review.id },
    });

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await answer(ctx, "Опубликовано в «Расширяем кругозор».");
  } catch {
    await answer(
      ctx,
      "Результат публикации не подтверждён. Повторно не отправляю, чтобы не создать дубль.",
      true,
    );
  }
}

export const contentReviewCorrectionHandler: MiddlewareFn<AuthContext> = async (ctx, next) => {
  const message = ctx.message;
  const from = ctx.from;
  if (!message || !("text" in message) || !message.reply_to_message || !from) return next();
  const replyTo = message.reply_to_message;

  const review = Object.values(REVIEWS).find(
    (item) =>
      item.ownerTelegramId === from.id &&
      ctx.chat?.type === "private" &&
      "text" in replyTo &&
      replyTo.text === item.correctionPrompt,
  );
  if (!review) return next();

  await clubEventRepository.createIfNotExists({
    telegramUpdateId: BigInt(ctx.update.update_id),
    dedupeKey: `content_review_correction:${review.id}:${message.message_id}`,
    eventType: "content_review_correction",
    chatTelegramId: BigInt(review.ownerTelegramId),
    userTelegramId: BigInt(from.id),
    messageTelegramId: message.message_id,
    targetMessageTelegramId: review.sourceMessageId,
    occurredAt: new Date(),
    payload: { reviewId: review.id, text: message.text },
  });

  await ctx.reply("Правка сохранена.");
};
