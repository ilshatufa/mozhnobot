import { ClubMembershipStatus, VpnBillingSubscriptionStatus, VpnSubscriptionAccessOverride, VpnTrialStatus } from "@prisma/client";
import { Markup } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";
import {
  buildPaidVpnActiveText,
  buildPaidVpnClubAccessText,
  buildPaidVpnFreeAccessText,
  buildPaidVpnOfferText,
  buildPaidVpnReferralText,
  buildPaidVpnTrialActiveText,
  PAID_VPN_BLOCKED_TEXT,
  PAID_VPN_FREE_PROVISIONING_ERROR_TEXT,
  PAID_VPN_PROVISIONING_ERROR_TEXT,
  PAID_VPN_STATUS_ERROR_TEXT,
  PAID_VPN_TRIAL_PROVISIONING_TEXT,
} from "../paid-vpn-copy.js";
import { vpnBillingService } from "../services/vpn-billing.service.js";
import { vpnAccessGrantService } from "../services/vpn-access-grant.service.js";
import { VPN_TRIAL_WHITELIST_LIMIT_BYTES } from "../services/vpn-entitlement.js";
import { vpnTrialService } from "../services/vpn-trial.service.js";
import { vpnService } from "../services/vpn.service.js";

const INCY_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-INCY-09-17";
const HAPP_SETUP_GUIDE_URL = "https://telegra.ph/Kak-podklyuchit-MOZHNO-VPN-v-HAPP-09-17";

function supportUrl(): string {
  return `https://t.me/${config.vpnBot.payments.supportUsername.slice(1)}`;
}

function offerKeyboard(salesAvailable: boolean, trialAvailable: boolean, amountStars: number) {
  const rows = [];
  if (trialAvailable) rows.push([Markup.button.callback("Начать бесплатно", "vpn_trial_start")]);
  if (salesAvailable) rows.push([Markup.button.callback(`30 дней — ${amountStars} ⭐`, "vpn_buy")]);
  if (config.vpnBot.payments.termsUrl) {
    rows.push([Markup.button.url("Условия", config.vpnBot.payments.termsUrl)]);
  }
  rows.push([Markup.button.callback("Пригласить друга", "vpn_referral")]);
  rows.push([Markup.button.url("Поддержка", supportUrl())]);
  return Markup.inlineKeyboard(rows);
}

function activeKeyboard(input: {
  subscriptionUrl: string;
  canCancel: boolean;
  canBuy?: boolean;
  amountStars: number;
}) {
  return Markup.inlineKeyboard([
    [Markup.button.url("Подключить VPN", input.subscriptionUrl)],
    [
      Markup.button.url("Установить INCY", INCY_SETUP_GUIDE_URL),
      Markup.button.url("Установить HAPP", HAPP_SETUP_GUIDE_URL),
    ],
    ...(input.canBuy
      ? [[Markup.button.callback(`30 дней — ${input.amountStars} ⭐`, "vpn_buy")]]
      : []),
    ...(input.canCancel
      ? [[Markup.button.callback("Отключить продление", "vpn_cancel")]]
      : []),
    [Markup.button.callback("Пригласить друга", "vpn_referral")],
    [Markup.button.url("Поддержка", supportUrl())],
  ]);
}

function retryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Проверить снова", "vpn_status")],
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
  options: { answerCallback?: boolean; referralAccepted?: boolean } = {},
): Promise<void> {
  if (ctx.callbackQuery && options.answerCallback !== false) await ctx.answerCbQuery();

  let messageId: number | null = null;
  if (ctx.callbackQuery && "message" in ctx.callbackQuery && ctx.callbackQuery.message) {
    messageId = ctx.callbackQuery.message.message_id;
  }

  if (ctx.dbUser.vpnBlocked) {
    await editOrReply(ctx, messageId, PAID_VPN_BLOCKED_TEXT, {});
    return;
  }

  let overview;
  let trialOverview;
  try {
    if (ctx.dbUser.clubStatus === ClubMembershipStatus.MEMBER) {
      await vpnAccessGrantService.pauseTimedAccessForUser(ctx.dbUser.id);
    } else {
      await vpnAccessGrantService.activatePendingForUser(ctx.dbUser.id);
    }
    [overview, trialOverview] = await Promise.all([
      vpnBillingService.getOverview(ctx.dbUser.id),
      vpnTrialService.getOverview(ctx.dbUser.id, new Date()),
    ]);
    if (
      overview.subscription?.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED &&
      !overview.subscription.accessPausedAt
    ) {
      await vpnAccessGrantService.pauseTimedAccessForUser(ctx.dbUser.id);
      overview = await vpnBillingService.getOverview(ctx.dbUser.id);
    }
  } catch (error) {
    logger.error("Failed to read paid VPN status", { userId: ctx.dbUser.id, error });
    await editOrReply(ctx, messageId, PAID_VPN_STATUS_ERROR_TEXT, {
      parse_mode: "HTML",
      ...retryKeyboard(),
    });
    return;
  }
  const subscription = overview.subscription;
  const billingSubscription = overview.billingSubscription;
  const now = new Date();
  const clubAccess = ctx.dbUser.clubStatus === ClubMembershipStatus.MEMBER;
  const freeAccess = subscription?.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED;
  const paidAccess = subscription?.expiresAt !== null && subscription?.expiresAt !== undefined && subscription.expiresAt > now;
  const activeTrial = trialOverview.trial?.status === VpnTrialStatus.ACTIVE &&
    trialOverview.trial.endsAt !== null && trialOverview.trial.endsAt > now &&
    !freeAccess && !paidAccess;

  const paymentsConfigured = Boolean(
    config.vpnBot.payments.termsUrl && config.vpnBot.payments.termsVersion,
  );
  const salesAvailable = paymentsConfigured && (
    config.vpnBot.payments.enabled || ctx.isPaidVpnAdmin
  );

  if (clubAccess || freeAccess || paidAccess || activeTrial) {
    try {
      let result = clubAccess
        ? await vpnService.getOrCreateKey(ctx.dbUser)
        : subscription
          ? await vpnService.getExistingPaidKey(subscription)
          : null;
      if (!result && !clubAccess) result = await vpnService.getPaidKey(ctx.dbUser);
      if (!result || (!clubAccess && !subscription)) throw new Error("VPN key is unavailable");
      const canCancel =
        billingSubscription?.status === VpnBillingSubscriptionStatus.ACTIVE &&
        Boolean(billingSubscription.telegramSubscriptionChargeId);
      const text = clubAccess
        ? buildPaidVpnClubAccessText({
            subscriptionUrl: result.key.subscriptionUrl,
            renewalActive: canCancel,
            nextChargeAt: billingSubscription?.payments[0]?.subscriptionExpirationDate,
          })
        : freeAccess
        ? buildPaidVpnFreeAccessText({
            subscriptionUrl: result.key.subscriptionUrl,
            paidExpiresAt: subscription!.expiresAt,
            nextChargeAt: billingSubscription?.payments[0]?.subscriptionExpirationDate,
            renewalActive: canCancel,
          })
        : activeTrial
          ? buildPaidVpnTrialActiveText({
              subscriptionUrl: result.key.subscriptionUrl,
              endsAt: trialOverview.trial?.endsAt as Date,
              whitelistUsedBytes: trialOverview.whitelistUsedBytes as bigint,
              whitelistLimitBytes: VPN_TRIAL_WHITELIST_LIMIT_BYTES,
            })
          : buildPaidVpnActiveText({
            subscriptionUrl: result.key.subscriptionUrl,
            expiresAt: subscription!.expiresAt as Date,
            nextChargeAt: billingSubscription?.payments[0]?.subscriptionExpirationDate,
            renewalState: renewalState(billingSubscription?.status),
          });
      await editOrReply(
        ctx,
        messageId,
        text,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...activeKeyboard({
            subscriptionUrl: result.key.subscriptionUrl,
            canCancel,
            canBuy: !clubAccess && activeTrial && salesAvailable,
            amountStars: config.vpnBot.payments.priceStars,
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
        messageId,
        clubAccess || freeAccess
          ? PAID_VPN_FREE_PROVISIONING_ERROR_TEXT
          : activeTrial
            ? PAID_VPN_TRIAL_PROVISIONING_TEXT
            : PAID_VPN_PROVISIONING_ERROR_TEXT,
        {
        parse_mode: "HTML",
        ...retryKeyboard(),
        },
      );
      return;
    }
  }

  if (trialOverview.trial?.status === VpnTrialStatus.PROVISIONING) {
    await editOrReply(ctx, messageId, PAID_VPN_TRIAL_PROVISIONING_TEXT, {
      parse_mode: "HTML",
      ...retryKeyboard(),
    });
    return;
  }

  const trialAvailable = paymentsConfigured &&
    (config.vpnBot.trial.enabled || ctx.isPaidVpnAdmin) &&
    trialOverview.trial === null &&
    !subscription?.expiresAt &&
    !freeAccess;
  const text = buildPaidVpnOfferText({
    amountStars: config.vpnBot.payments.priceStars,
    expiredAt: subscription?.expiresAt,
    salesAvailable,
    trialAvailable,
    trialExpiredAt: trialOverview.trial?.status === VpnTrialStatus.EXPIRED
      ? trialOverview.trial.endsAt
      : null,
    adminConfigurationMissing: ctx.isPaidVpnAdmin && !paymentsConfigured,
    referralAccepted: options.referralAccepted,
  });
  await editOrReply(ctx, messageId, text, {
    parse_mode: "HTML",
    ...offerKeyboard(salesAvailable, trialAvailable, config.vpnBot.payments.priceStars),
  });
}

export async function showPaidVpnReferralScreen(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  if (ctx.dbUser.vpnBlocked) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }
  const [code, stats] = await Promise.all([
    vpnAccessGrantService.ensureReferralCode(ctx.dbUser.id),
    vpnAccessGrantService.getReferralStats(ctx.dbUser.id),
  ]);
  const botUsername = ctx.botInfo.username;
  const referralUrl = `https://t.me/${botUsername}?start=ref_${code}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${encodeURIComponent("7 дней МОЖНО VPN бесплатно")}`;
  await editOrReply(
    ctx,
    ctx.callbackQuery && "message" in ctx.callbackQuery && ctx.callbackQuery.message
      ? ctx.callbackQuery.message.message_id
      : null,
    buildPaidVpnReferralText({ referralUrl, ...stats }),
    {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        [Markup.button.url("Поделиться ссылкой", shareUrl)],
        [Markup.button.callback("Назад", "vpn_status")],
      ]),
    },
  );
}
