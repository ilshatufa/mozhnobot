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
  clubniAccessInviteName,
  clubniAccessJoinDecision,
  clubniAccessInviteTarget,
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

async function createPersonalInvite(
  ctx: Context,
  event: ClubniPaymentEvent,
): Promise<string> {
  const invite = await ctx.telegram.createChatInviteLink(config.clubGroupId, {
    name: clubniAccessInviteName(event.telegramUserId),
    creates_join_request: true,
  });
  return invite.invite_link;
}

async function sendFinal(
  ctx: Context,
  event: ClubniPaymentEvent,
  inviteUrl: string,
): Promise<void> {
  await ctx.telegram.sendMessage(event.telegramUserId, CLUBNI_ONBOARDING_FINAL_TEXT, {
    reply_markup: {
      inline_keyboard: [[{
        text: "Вступить в группу",
        url: inviteUrl,
      }]],
    },
  });
}

async function reportAccessError(
  ctx: Context,
  event: ClubniPaymentEvent,
  error: unknown,
): Promise<void> {
  logger.error("Failed to create Clubni group access", {
    subscriptionId: event.subscriptionId,
    targetTelegramUserId: event.telegramUserId,
    error: error instanceof Error ? error.message : String(error),
  });
  await ctx.telegram.sendMessage(
    event.telegramUserId,
    "Не удалось открыть доступ в группу. Попробуй ещё раз позже.",
  );
}

export function clubniPaymentMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!config.clubniPayment.enabled || config.clubniPayment.sourceBotTelegramId === null) {
      return next();
    }

    if ("chat_join_request" in ctx.update) {
      const request = ctx.update.chat_join_request;
      const targetTelegramUserId = clubniAccessInviteTarget(
        request.invite_link?.name,
      );
      const decision = clubniAccessJoinDecision(
        request.invite_link?.name,
        request.from.id,
      );
      if (
        String(request.chat.id) === config.clubGroupId &&
        targetTelegramUserId !== null &&
        decision !== "ignore"
      ) {
        if (decision === "approve") {
          await ctx.telegram.approveChatJoinRequest(
            config.clubGroupId,
            request.from.id,
          );
        } else {
          await ctx.telegram.declineChatJoinRequest(
            config.clubGroupId,
            request.from.id,
          );
        }
        logger.info("Clubni group join request processed", {
          targetTelegramUserId,
          requesterTelegramUserId: request.from.id,
          approved: decision === "approve",
        });
        return next();
      }
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
      try {
        await sendOrResumeClubniOnboarding(event, clubEventRepository, {
          sendIntro: (payment) => sendIntro(ctx, payment),
          sendQuestionReminder: (payment) => sendQuestionReminder(ctx, payment),
          sendVideo2: (payment) => sendVideo2(ctx, payment),
          createInvite: (payment) => createPersonalInvite(ctx, payment),
          sendFinal: (payment, inviteUrl) => sendFinal(ctx, payment, inviteUrl),
        });
      } catch (error) {
        await reportAccessError(ctx, event, error);
      }
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
        try {
          await finishClubniOnboarding(
            event,
            clubEventRepository,
            (payment) => createPersonalInvite(ctx, payment),
            (payment, inviteUrl) => sendFinal(ctx, payment, inviteUrl),
          );
        } catch (error) {
          await reportAccessError(ctx, event, error);
        }
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
