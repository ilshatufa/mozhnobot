import {
  ClubMembershipStatus,
  VpnSubscriptionAccessOverride,
  VpnTrialStatus,
} from "@prisma/client";
import { Markup, type MiddlewareFn } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  buildPaidVpnSupportAdminReplyPrompt,
  buildPaidVpnSupportAdminText,
  formatPaidVpnDate,
  PAID_VPN_SUPPORT_ADMIN_DELIVERY_ERROR_TEXT,
  PAID_VPN_SUPPORT_ADMIN_SENT_TEXT,
  PAID_VPN_SUPPORT_PROMPT_TEXT,
  PAID_VPN_SUPPORT_RESPONSE_TEXT,
  PAID_VPN_SUPPORT_SEND_ERROR_TEXT,
  PAID_VPN_SUPPORT_SENT_TEXT,
  PAID_VPN_SUPPORT_UNSUPPORTED_TEXT,
} from "../paid-vpn-copy.js";
import {
  buildVpnSupportReplyAction,
  isVpnSupportUserPromptReply,
  parseVpnSupportAdminPromptTarget,
  parseVpnSupportReplyAction,
  VPN_SUPPORT_ACTION,
} from "../paid-vpn-support-flow.js";
import { vpnBillingService } from "../services/vpn-billing.service.js";
import { vpnTrialService } from "../services/vpn-trial.service.js";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";

interface SupportMessage {
  message_id: number;
  text?: string;
  photo?: unknown;
  document?: unknown;
  reply_to_message?: { text?: string };
}

function forceReply(placeholder: string) {
  return {
    reply_markup: {
      force_reply: true as const,
      selective: true,
      input_field_placeholder: placeholder,
    },
  };
}

function callbackData(ctx: PaidVpnContext): string | undefined {
  if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) return undefined;
  return ctx.callbackQuery.data;
}

function supportMessage(ctx: PaidVpnContext): SupportMessage | null {
  return (ctx.message as SupportMessage | undefined) ?? null;
}

function isSupportedContent(message: SupportMessage): boolean {
  return typeof message.text === "string" || Boolean(message.photo) || Boolean(message.document);
}

async function describeAccess(ctx: PaidVpnContext): Promise<string> {
  if (ctx.dbUser.isBanned) return "бот заблокирован";
  if (ctx.dbUser.vpnBlocked) return "VPN заблокирован";
  if (ctx.dbUser.clubStatus === ClubMembershipStatus.MEMBER) return "входит в клуб";

  const now = new Date();
  const [overview, trialOverview] = await Promise.all([
    vpnBillingService.getOverview(ctx.dbUser.id),
    vpnTrialService.getOverview(ctx.dbUser.id, now),
  ]);
  const subscription = overview.subscription;
  if (subscription?.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED) {
    return "бесплатный доступ без срока";
  }
  if (subscription?.expiresAt && subscription.expiresAt > now) {
    return `оплачен до ${formatPaidVpnDate(subscription.expiresAt)}`;
  }
  if (
    trialOverview.trial?.status === VpnTrialStatus.ACTIVE &&
    trialOverview.trial.endsAt &&
    trialOverview.trial.endsAt > now
  ) {
    return `пробный период до ${formatPaidVpnDate(trialOverview.trial.endsAt)}`;
  }
  if (trialOverview.trial?.status === VpnTrialStatus.PROVISIONING) {
    return "пробный доступ подключается";
  }
  if (subscription?.expiresAt) {
    return `оплаченный период закончился ${formatPaidVpnDate(subscription.expiresAt)}`;
  }
  if (trialOverview.trial?.endsAt) {
    return `пробный период закончился ${formatPaidVpnDate(trialOverview.trial.endsAt)}`;
  }
  return "активного доступа нет";
}

export async function paidVpnSupportHandler(ctx: PaidVpnContext): Promise<void> {
  if (ctx.callbackQuery) await ctx.answerCbQuery();
  await ctx.reply(PAID_VPN_SUPPORT_PROMPT_TEXT, {
    parse_mode: "HTML",
    ...forceReply("Опиши проблему"),
  });
}

export async function paidVpnSupportReplyStartHandler(ctx: PaidVpnContext): Promise<void> {
  const telegramId = parseVpnSupportReplyAction(callbackData(ctx));
  if (!telegramId) {
    await ctx.answerCbQuery("Не удалось определить пользователя.");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.reply(buildPaidVpnSupportAdminReplyPrompt(telegramId), {
    parse_mode: "HTML",
    ...forceReply("Напиши ответ"),
  });
}

async function sendRequestToAdmin(ctx: PaidVpnContext, message: SupportMessage): Promise<void> {
  const adminTelegramId = config.vpnBot.adminTelegramId;
  if (!adminTelegramId || !ctx.chat) {
    await ctx.reply(PAID_VPN_SUPPORT_SEND_ERROR_TEXT, { parse_mode: "HTML" });
    return;
  }

  try {
    const accessStatus = await describeAccess(ctx);
    const copied = await ctx.telegram.copyMessage(
      Number(adminTelegramId),
      ctx.chat.id,
      message.message_id,
    );
    await ctx.telegram.sendMessage(
      Number(adminTelegramId),
      buildPaidVpnSupportAdminText({
        firstName: ctx.dbUser.firstName,
        lastName: ctx.dbUser.lastName,
        username: ctx.dbUser.username,
        telegramId: ctx.dbUser.telegramId,
        accessStatus,
      }),
      {
        parse_mode: "HTML",
        reply_parameters: { message_id: copied.message_id },
        ...Markup.inlineKeyboard([[
          Markup.button.callback(
            "Ответить",
            buildVpnSupportReplyAction(ctx.dbUser.telegramId),
          ),
        ]]),
      },
    );
    await ctx.reply(PAID_VPN_SUPPORT_SENT_TEXT, { parse_mode: "HTML" });
    logger.info("Paid VPN support request sent to admin", { userId: ctx.dbUser.id });
  } catch (error) {
    logger.error("Failed to send paid VPN support request", {
      userId: ctx.dbUser.id,
      error,
    });
    await ctx.reply(PAID_VPN_SUPPORT_SEND_ERROR_TEXT, { parse_mode: "HTML" });
  }
}

async function sendAdminReply(
  ctx: PaidVpnContext,
  message: SupportMessage,
  telegramId: number,
): Promise<void> {
  if (!ctx.chat) return;
  try {
    const replyKeyboard = Markup.inlineKeyboard([[
      Markup.button.callback("Ответить поддержке", VPN_SUPPORT_ACTION),
    ]]);
    const heading = await ctx.telegram.sendMessage(
      telegramId,
      PAID_VPN_SUPPORT_RESPONSE_TEXT,
      { parse_mode: "HTML", ...replyKeyboard },
    );
    await ctx.telegram.copyMessage(
      telegramId,
      ctx.chat.id,
      message.message_id,
      {
        reply_parameters: { message_id: heading.message_id },
      },
    );
    await ctx.reply(PAID_VPN_SUPPORT_ADMIN_SENT_TEXT);
    logger.info("Paid VPN support reply delivered", {
      adminUserId: ctx.dbUser.id,
      targetTelegramId: telegramId,
    });
  } catch (error) {
    logger.warn("Failed to deliver paid VPN support reply", {
      adminUserId: ctx.dbUser.id,
      targetTelegramId: telegramId,
      error,
    });
    await ctx.reply(PAID_VPN_SUPPORT_ADMIN_DELIVERY_ERROR_TEXT);
  }
}

export const paidVpnSupportMessageHandler: MiddlewareFn<PaidVpnContext> = async (ctx, next) => {
  const message = supportMessage(ctx);
  const replyText = message?.reply_to_message?.text;
  if (!message || !replyText) return next();

  if (ctx.isPaidVpnAdmin) {
    const targetTelegramId = parseVpnSupportAdminPromptTarget(replyText);
    if (targetTelegramId) {
      if (!isSupportedContent(message)) {
        await ctx.reply(PAID_VPN_SUPPORT_UNSUPPORTED_TEXT, { parse_mode: "HTML" });
        return;
      }
      await sendAdminReply(ctx, message, targetTelegramId);
      return;
    }
  }

  if (!isVpnSupportUserPromptReply(replyText)) return next();
  if (!isSupportedContent(message)) {
    await ctx.reply(PAID_VPN_SUPPORT_UNSUPPORTED_TEXT, { parse_mode: "HTML" });
    return;
  }
  await sendRequestToAdmin(ctx, message);
};
