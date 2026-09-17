import { VpnBillingSubscriptionStatus, VpnSubscriptionAccessOverride } from "@prisma/client";
import { Markup } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";
import {
  buildPaidVpnActiveText,
  buildPaidVpnFreeAccessText,
  buildPaidVpnOfferText,
  PAID_VPN_BLOCKED_TEXT,
  PAID_VPN_FREE_PROVISIONING_ERROR_TEXT,
  PAID_VPN_PROGRESS_TEXT,
  PAID_VPN_PROVISIONING_ERROR_TEXT,
} from "../paid-vpn-copy.js";
import { vpnBillingService } from "../services/vpn-billing.service.js";
import { vpnService } from "../services/vpn.service.js";

const INCY_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-INCY-09-07";
const HAPP_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-HAPP-09-07";

function supportUrl(): string {
  return `https://t.me/${config.vpnBot.payments.supportUsername.slice(1)}`;
}

function offerKeyboard(salesAvailable: boolean) {
  const rows = [];
  if (salesAvailable) rows.push([Markup.button.callback("Оплатить", "vpn_buy")]);
  if (config.vpnBot.payments.termsUrl) {
    rows.push([Markup.button.url("Условия", config.vpnBot.payments.termsUrl)]);
  }
  rows.push([Markup.button.url("Поддержка", supportUrl())]);
  return Markup.inlineKeyboard(rows);
}

function activeKeyboard(input: {
  subscriptionUrl: string;
  canCancel: boolean;
}) {
  return Markup.inlineKeyboard([
    [Markup.button.url("Открыть подписку", input.subscriptionUrl)],
    [
      Markup.button.url("INCY", INCY_SETUP_GUIDE_URL),
      Markup.button.url("HAPP", HAPP_SETUP_GUIDE_URL),
    ],
    ...(input.canCancel
      ? [[Markup.button.callback("Отключить продление", "vpn_cancel")]]
      : []),
    [Markup.button.url("Поддержка", supportUrl())],
  ]);
}

function retryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Проверить доступ", "vpn_status")],
    [Markup.button.url("Поддержка", supportUrl())],
  ]);
}

async function editOrReply(
  ctx: PaidVpnContext,
  messageId: number | null,
  text: string,
  extra: {
    parse_mode?: "HTML";
    link_preview_options?: { is_disabled?: boolean };
    reply_markup?: InlineKeyboardMarkup;
  },
): Promise<void> {
  if (messageId !== null && ctx.chat) {
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, extra);
    return;
  }
  await ctx.reply(text, extra);
}

function renewalState(status: VpnBillingSubscriptionStatus | undefined): "active" | "canceled" | "failed" | "unknown" {
  switch (status) {
    case VpnBillingSubscriptionStatus.ACTIVE:
      return "active";
    case VpnBillingSubscriptionStatus.CANCELED:
      return "canceled";
    case VpnBillingSubscriptionStatus.FAILED:
      return "failed";
    default:
      return "unknown";
  }
}

export async function showPaidVpnScreen(
  ctx: PaidVpnContext,
  options: { answerCallback?: boolean } = {},
): Promise<void> {
  if (ctx.callbackQuery && options.answerCallback !== false) await ctx.answerCbQuery();

  let progressMessageId: number | null = null;
  if (ctx.callbackQuery && "message" in ctx.callbackQuery && ctx.callbackQuery.message) {
    progressMessageId = ctx.callbackQuery.message.message_id;
    if (ctx.chat) {
      await ctx.telegram.editMessageText(ctx.chat.id, progressMessageId, undefined, PAID_VPN_PROGRESS_TEXT);
    }
  } else {
    const progress = await ctx.reply(PAID_VPN_PROGRESS_TEXT);
    progressMessageId = progress.message_id;
  }

  if (ctx.dbUser.vpnBlocked) {
    await editOrReply(ctx, progressMessageId, PAID_VPN_BLOCKED_TEXT, {});
    return;
  }

  const overview = await vpnBillingService.getOverview(ctx.dbUser.id);
  const subscription = overview.subscription;
  const billingSubscription = overview.billingSubscription;
  const now = new Date();
  const freeAccess = subscription?.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED;
  const paidAccess = subscription?.expiresAt !== null && subscription?.expiresAt !== undefined && subscription.expiresAt > now;

  if (freeAccess || paidAccess) {
    try {
      const result = await vpnService.getPaidKey(ctx.dbUser);
      if (!result || !subscription) throw new Error("Paid VPN key is unavailable");
      const canCancel =
        billingSubscription?.status === VpnBillingSubscriptionStatus.ACTIVE &&
        Boolean(billingSubscription.telegramSubscriptionChargeId);
      const text = freeAccess
        ? buildPaidVpnFreeAccessText({
            subscriptionUrl: result.key.subscriptionUrl,
            paidExpiresAt: subscription.expiresAt,
            renewalActive: canCancel,
          })
        : buildPaidVpnActiveText({
            subscriptionUrl: result.key.subscriptionUrl,
            expiresAt: subscription.expiresAt as Date,
            renewalState: renewalState(billingSubscription?.status),
          });
      await editOrReply(
        ctx,
        progressMessageId,
        text,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...activeKeyboard({
            subscriptionUrl: result.key.subscriptionUrl,
            canCancel,
          }),
        },
      );
      return;
    } catch (error) {
      logger.error("Failed to prepare paid VPN access screen", {
        userId: ctx.dbUser.id,
        error,
      });
      await editOrReply(
        ctx,
        progressMessageId,
        freeAccess ? PAID_VPN_FREE_PROVISIONING_ERROR_TEXT : PAID_VPN_PROVISIONING_ERROR_TEXT,
        {
        parse_mode: "HTML",
        ...retryKeyboard(),
        },
      );
      return;
    }
  }

  const paymentsConfigured = Boolean(
    config.vpnBot.payments.termsUrl && config.vpnBot.payments.termsVersion,
  );
  const salesAvailable = paymentsConfigured && (
    config.vpnBot.payments.enabled || ctx.isPaidVpnAdmin
  );
  const text = buildPaidVpnOfferText({
    amountStars: config.vpnBot.payments.priceStars,
    expiredAt: subscription?.expiresAt,
    salesAvailable,
    adminConfigurationMissing: ctx.isPaidVpnAdmin && !paymentsConfigured,
  });
  await editOrReply(ctx, progressMessageId, text, {
    parse_mode: "HTML",
    ...offerKeyboard(salesAvailable),
  });
}
