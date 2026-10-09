import { fileURLToPath } from "node:url";
import { Input, type Context, type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { clubEventRepository } from "../repositories/club-event.repository.js";
import {
  CLUBNI_ONBOARDING_FINAL_TEXT,
  CLUBNI_ONBOARDING_NEXT_PREFIX,
  CLUBNI_ONBOARDING_QUESTION,
  CLUBNI_ONBOARDING_START_PREFIX,
  CLUBNI_PAYMENT_WELCOME_TEXT,
  deliverClubniPaymentWelcome,
  findLatestClubniPayment,
  finishClubniOnboarding,
  parseClubniPaymentCommand,
  saveClubniOnboardingAnswer,
  sendOrResumeClubniOnboarding,
  startClubniOnboarding,
  type ClubniPaymentEvent,
} from "../services/clubni-payment.service.js";

const VIDEO_1_PATH = fileURLToPath(
  new URL("../../assets/clubni-onboarding/video-1.mp4", import.meta.url),
);
const VIDEO_2_PATH = fileURLToPath(
  new URL("../../assets/clubni-onboarding/video-2.mp4", import.meta.url),
);

function isPrivateHumanUpdate(ctx: Context): boolean {
  return Boolean(
    ctx.from &&
    !ctx.from.is_bot &&
    ctx.chat?.type === "private" &&
    (ctx.updateType === "message" || ctx.updateType === "callback_query"),
  );
}

async function sendIntro(ctx: Context, event: ClubniPaymentEvent): Promise<void> {
  await ctx.telegram.sendMessage(event.telegramUserId, CLUBNI_PAYMENT_WELCOME_TEXT, {
    reply_markup: {
      inline_keyboard: [[{
        text: "Начать знакомство",
        callback_data: `${CLUBNI_ONBOARDING_START_PREFIX}${event.subscriptionId}`,
      }]],
    },
  });
}

async function sendVideo1(ctx: Context, event: ClubniPaymentEvent): Promise<void> {
  await ctx.telegram.sendVideo(
    event.telegramUserId,
    Input.fromLocalFile(VIDEO_1_PATH),
    {
      caption: `${CLUBNI_ONBOARDING_QUESTION}\n\nНапиши ответ одним сообщением.`,
    },
  );
}

async function sendQuestionReminder(
  ctx: Context,
  event: ClubniPaymentEvent,
): Promise<void> {
  await ctx.telegram.sendMessage(
    event.telegramUserId,
    `${CLUBNI_ONBOARDING_QUESTION}\n\nНапиши ответ одним сообщением.`,
  );
}

async function sendVideo2(ctx: Context, event: ClubniPaymentEvent): Promise<void> {
  await ctx.telegram.sendVideo(
    event.telegramUserId,
    Input.fromLocalFile(VIDEO_2_PATH),
    {
      caption: "Спасибо, ответ сохранён👌 Посмотри второе короткое видео.",
      reply_markup: {
        inline_keyboard: [[{
          text: "Продолжить",
          callback_data: `${CLUBNI_ONBOARDING_NEXT_PREFIX}${event.subscriptionId}`,
        }]],
      },
    },
  );
}

async function sendFinal(ctx: Context, event: ClubniPaymentEvent): Promise<void> {
  if (!event.inviteUrl) {
    throw new Error("Clubni onboarding event has no personal invite URL");
  }
  await ctx.telegram.sendMessage(event.telegramUserId, CLUBNI_ONBOARDING_FINAL_TEXT, {
    reply_markup: {
      inline_keyboard: [[{
        text: "Перейти в клуб",
        url: event.inviteUrl,
      }]],
    },
  });
}

export function clubniPaymentMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!config.clubniPayment.enabled || config.clubniPayment.sourceBotTelegramId === null) {
      return next();
    }

    const trustedClubniBot =
      ctx.from?.is_bot &&
      BigInt(ctx.from.id) === config.clubniPayment.sourceBotTelegramId &&
      ctx.chat?.type === "private" &&
      ctx.message &&
      "text" in ctx.message;

    if (trustedClubniBot) {
      if (/^\/clubni_probe(?:\s|$)/.test(ctx.message.text)) {
        logger.info("Clubni bot-to-bot probe received", {
          sourceBotTelegramId: ctx.from.id,
        });
        return;
      }
      if (!ctx.message.text.startsWith("/clubni_payment")) return next();

      const event = parseClubniPaymentCommand(ctx.message.text);
      if (!event) {
        logger.warn("Invalid Clubni payment event ignored", {
          sourceBotTelegramId: ctx.from.id,
        });
        return;
      }

      const result = await deliverClubniPaymentWelcome(
        event,
        config.clubniPayment.clubId,
        {
          repository: clubEventRepository,
          sendIntro: (payment) => sendIntro(ctx, payment),
        },
      );
      logger.info("Clubni payment event processed", {
        result,
        eventId: event.eventId,
        subscriptionId: event.subscriptionId,
        targetTelegramUserId: event.telegramUserId,
      });
      return;
    }

    if (!isPrivateHumanUpdate(ctx) || !ctx.from) return next();
    const event = await findLatestClubniPayment(
      ctx.from.id,
      config.clubniPayment.clubId,
      clubEventRepository,
    );
    if (!event) return next();

    const message = ctx.message;
    if (
      message &&
      "text" in message &&
      /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text)
    ) {
      await sendOrResumeClubniOnboarding(event, clubEventRepository, {
        sendIntro: (payment) => sendIntro(ctx, payment),
        sendQuestionReminder: (payment) => sendQuestionReminder(ctx, payment),
        sendVideo2: (payment) => sendVideo2(ctx, payment),
        sendFinal: (payment) => sendFinal(ctx, payment),
      });
      return;
    }

    const callbackQuery = ctx.callbackQuery;
    if (callbackQuery && "data" in callbackQuery) {
      if (
        callbackQuery.data ===
        `${CLUBNI_ONBOARDING_START_PREFIX}${event.subscriptionId}`
      ) {
        await ctx.answerCbQuery();
        await startClubniOnboarding(
          event,
          clubEventRepository,
          (payment) => sendVideo1(ctx, payment),
        );
        return;
      }
      if (
        callbackQuery.data ===
        `${CLUBNI_ONBOARDING_NEXT_PREFIX}${event.subscriptionId}`
      ) {
        await ctx.answerCbQuery();
        await finishClubniOnboarding(
          event,
          clubEventRepository,
          (payment) => sendFinal(ctx, payment),
        );
        return;
      }
    }

    if (
      message &&
      "text" in message &&
      !message.text.startsWith("/")
    ) {
      const result = await saveClubniOnboardingAnswer(
        event,
        message.text,
        clubEventRepository,
        (payment) => sendVideo2(ctx, payment),
      );
      if (result !== "not_awaiting") return;
    }

    return next();
  };
}
