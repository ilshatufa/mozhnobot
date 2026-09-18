import type { InlineKeyboardButton, InlineKeyboardMarkup, SuccessfulPayment } from "@telegraf/types";
import { ClubMembershipStatus, VpnSubscriptionAccessOverride } from "@prisma/client";
import { Markup } from "telegraf";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { type PaidVpnContext } from "../middlewares/paid-vpn-auth.js";
import {
  buildPaidVpnCancelConfirmationText,
  buildPaidVpnConfirmationText,
  buildPaidVpnInvoiceReadyText,
  buildPaidVpnPaymentReadyText,
  buildPaidVpnStarsHelpText,
  buildPaidVpnTermsText,
  buildVpnReferralRewardText,
  PAID_VPN_INVOICE_ERROR_TEXT,
  PAID_VPN_PAYMENT_BANKED_TEXT,
  PAID_VPN_PREMIUM_BOT_URL,
  PAID_VPN_PROVISIONING_ERROR_TEXT,
} from "../paid-vpn-copy.js";
import {
  VPN_STARS_CURRENCY,
  VPN_SUBSCRIPTION_PERIOD_SECONDS,
  vpnBillingService,
} from "../services/vpn-billing.service.js";
import { vpnService } from "../services/vpn.service.js";
import { vpnAccessGrantService } from "../services/vpn-access-grant.service.js";
import { vpnTrialService } from "../services/vpn-trial.service.js";
import { userRepository } from "../repositories/user.repository.js";
import { showPaidVpnScreen } from "./paid-vpn-screen.js";
import { VPN_SUPPORT_ACTION } from "../paid-vpn-support-flow.js";

interface BotSubscriptionUpdated {
  user: { id: number };
  invoice_payload: string;
  state: "active" | "canceled" | "failed";
}

export interface PaidVpnSubscriptionInvoiceLinkRequest {
  title: string;
  description: string;
  payload: string;
  currency: typeof VPN_STARS_CURRENCY;
  prices: Array<{ label: string; amount: number }>;
  subscription_period: number;
}
interface EditUserStarSubscriptionRequest {
  user_id: number;
  telegram_payment_charge_id: string;
  is_canceled: boolean;
}
type RecurringSuccessfulPayment = SuccessfulPayment & {
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
};
type TextExtra = {
  parse_mode?: "HTML";
  link_preview_options?: { is_disabled?: boolean };
  reply_markup?: InlineKeyboardMarkup;
};

interface RawTelegramApi {
  callApi(method: string, payload: Record<string, unknown>): Promise<unknown>;
}

export function buildPaidVpnSubscriptionInvoiceLinkRequest(input: {
  invoicePayload: string;
  amountStars: number;
}): PaidVpnSubscriptionInvoiceLinkRequest {
  return {
    title: "МОЖНО VPN — 30 дней",
    description: "Нидерланды, Германия и Латвия без лимита; белые списки — 10 ГБ. Автопродление каждые 30 дней.",
    payload: input.invoicePayload,
    currency: VPN_STARS_CURRENCY,
    prices: [{ label: "МОЖНО VPN — 30 дней", amount: input.amountStars }],
    subscription_period: VPN_SUBSCRIPTION_PERIOD_SECONDS,
  };
}

function salesAllowedFor(telegramId: number): boolean {
  return config.vpnBot.payments.enabled ||
    config.vpnBot.adminTelegramId === BigInt(telegramId);
}

function paymentsConfigured(): boolean {
  return Boolean(config.vpnBot.payments.termsUrl && config.vpnBot.payments.termsVersion);
}

async function editCallbackMessage(
  ctx: PaidVpnContext,
  text: string,
  extra: TextExtra,
): Promise<void> {
  if (!ctx.callbackQuery || !("message" in ctx.callbackQuery) || !ctx.callbackQuery.message || !ctx.chat) {
    await ctx.reply(text, extra);
    return;
  }
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    ctx.callbackQuery.message.message_id,
    undefined,
    text,
    extra,
  );
}

export async function paidVpnBuyHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  const overview = await vpnBillingService.getOverview(ctx.dbUser.id);
  if (
    overview.subscription?.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
    (overview.subscription?.expiresAt && overview.subscription.expiresAt > new Date())
  ) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }

  const canSell = salesAllowedFor(ctx.from?.id ?? 0) && paymentsConfigured();
  if (!canSell) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }

  const trial = await vpnTrialService.findTrial(ctx.dbUser.id);
  const trialActive = trial?.status === "ACTIVE" && trial.endsAt !== null && trial.endsAt > new Date();
  await editCallbackMessage(
    ctx,
    buildPaidVpnConfirmationText({
      amountStars: config.vpnBot.payments.priceStars,
      trialActive,
    }),
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Перейти к оплате", "vpn_buy_confirm")],
        [Markup.button.url("Купить звёзды", PAID_VPN_PREMIUM_BOT_URL)],
        [Markup.button.url("Условия", config.vpnBot.payments.termsUrl)],
        [Markup.button.callback("Назад", "vpn_status")],
      ]),
    },
  );
}

export async function paidVpnStarsHelpHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  await editCallbackMessage(ctx, buildPaidVpnStarsHelpText({
    amountStars: config.vpnBot.payments.priceStars,
  }), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.url("Открыть @PremiumBot", PAID_VPN_PREMIUM_BOT_URL)],
      [Markup.button.callback("Назад к оплате", "vpn_buy")],
    ]),
  });
}

export async function paidVpnTrialStartHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  const configured = paymentsConfigured();
  const allowed = config.vpnBot.trial.enabled || ctx.isPaidVpnAdmin;
  if (!configured || !allowed || ctx.dbUser.vpnBlocked || ctx.dbUser.isBanned) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }

  await editCallbackMessage(ctx, "Готовлю четыре VPN-профиля…", {});
  const result = await vpnTrialService.startTrial({
    user: ctx.dbUser,
    termsVersion: config.vpnBot.payments.termsVersion,
    acceptedAt: new Date(),
  });
  if (result.status === "PROVISIONING") {
    logger.warn("Paid VPN trial provisioning is incomplete", {
      userId: ctx.dbUser.id,
      errors: result.errors,
    });
  }
  await showPaidVpnScreen(ctx, { answerCallback: false });
}

export async function paidVpnBuyConfirmHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!telegramId || !chatId || !salesAllowedFor(telegramId) || !paymentsConfigured()) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }

  const overview = await vpnBillingService.getOverview(ctx.dbUser.id);
  if (
    overview.subscription?.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
    (overview.subscription?.expiresAt && overview.subscription.expiresAt > new Date())
  ) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }

  const created = await vpnBillingService.createInvoice({
    userId: ctx.dbUser.id,
    amountStars: config.vpnBot.payments.priceStars,
    termsVersion: config.vpnBot.payments.termsVersion,
    acceptedAt: new Date(),
  });
  if (created.accessAlreadyAvailable) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }

  const invoice = buildPaidVpnSubscriptionInvoiceLinkRequest({
    invoicePayload: created.billingSubscription.invoicePayload,
    amountStars: created.billingSubscription.amountStars,
  });
  try {
    const invoiceLink = await (ctx.telegram as unknown as RawTelegramApi).callApi(
      "createInvoiceLink",
      invoice as unknown as Record<string, unknown>,
    );
    if (typeof invoiceLink !== "string" || !invoiceLink.trim()) {
      throw new Error("Telegram returned an empty VPN subscription invoice link");
    }
    logger.info("Paid VPN Stars invoice link created", {
      userId: ctx.dbUser.id,
      billingSubscriptionId: created.billingSubscription.id,
      amountStars: created.billingSubscription.amountStars,
    });
    await editCallbackMessage(ctx, buildPaidVpnInvoiceReadyText({
      amountStars: created.billingSubscription.amountStars,
    }), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.url(`Оплатить ${created.billingSubscription.amountStars} ⭐`, invoiceLink)],
        [Markup.button.url("Купить звёзды", PAID_VPN_PREMIUM_BOT_URL)],
        [Markup.button.callback("Назад", "vpn_status")],
        [Markup.button.callback("Поддержка", VPN_SUPPORT_ACTION)],
      ]),
    });
  } catch (error) {
    logger.error("Failed to create paid VPN Stars invoice link", {
      userId: ctx.dbUser.id,
      billingSubscriptionId: created.billingSubscription.id,
      error,
    });
    await editCallbackMessage(ctx, PAID_VPN_INVOICE_ERROR_TEXT, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Попробовать снова", "vpn_buy_confirm")],
        [Markup.button.callback("Поддержка", VPN_SUPPORT_ACTION)],
      ]),
    });
  }
}

export async function paidVpnPreCheckoutHandler(ctx: PaidVpnContext): Promise<void> {
  const query = (ctx.update as unknown as {
    pre_checkout_query: {
      id: string;
      from: { id: number };
      invoice_payload: string;
      currency: string;
      total_amount: number;
    };
  }).pre_checkout_query;
  const validation = await vpnBillingService.validateCheckout({
    telegramId: BigInt(query.from.id),
    invoicePayload: query.invoice_payload,
    currency: query.currency,
    totalAmount: query.total_amount,
    configuredAmountStars: config.vpnBot.payments.priceStars,
    configuredTermsVersion: config.vpnBot.payments.termsVersion,
    salesAllowed: salesAllowedFor(query.from.id) && paymentsConfigured(),
  });
  if (!validation.ok) {
    await ctx.answerPreCheckoutQuery(false, validation.reason);
    logger.warn("Paid VPN Stars pre-checkout rejected", {
      userId: ctx.dbUser.id,
      reason: validation.reason,
    });
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
  logger.info("Paid VPN Stars pre-checkout accepted", {
    userId: ctx.dbUser.id,
    billingSubscriptionId: validation.billingSubscription?.id,
  });
}

export async function paidVpnSuccessfulPaymentHandler(ctx: PaidVpnContext): Promise<void> {
  const message = ctx.message;
  if (!message || !("successful_payment" in message)) return;
  const successfulPayment = message.successful_payment as RecurringSuccessfulPayment;
  if (!successfulPayment.subscription_expiration_date) {
    logger.error("Paid VPN Stars payment has no subscription expiration", {
      userId: ctx.dbUser.id,
      chargeId: successfulPayment.telegram_payment_charge_id,
    });
    await ctx.reply(PAID_VPN_PROVISIONING_ERROR_TEXT, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("Поддержка", VPN_SUPPORT_ACTION)]]),
    });
    return;
  }

  const result = await vpnBillingService.recordSuccessfulPayment({
    telegramId: ctx.dbUser.telegramId,
    invoicePayload: successfulPayment.invoice_payload,
    telegramPaymentChargeId: successfulPayment.telegram_payment_charge_id,
    providerPaymentChargeId: successfulPayment.provider_payment_charge_id || null,
    currency: successfulPayment.currency,
    totalAmount: successfulPayment.total_amount,
    isRecurring: successfulPayment.is_recurring === true,
    isFirstRecurring: successfulPayment.is_first_recurring === true,
    subscriptionExpirationDate: new Date(successfulPayment.subscription_expiration_date * 1000),
    paidAt: new Date(message.date * 1000),
  });
  let referralReward;
  try {
    referralReward = await vpnAccessGrantService.rewardReferralForPayment(
      result.payment.id,
      result.payment.paidAt,
    );
  } catch (error) {
    logger.error("Failed to apply paid VPN referral reward", {
      userId: ctx.dbUser.id,
      paymentId: result.payment.id,
      error,
    });
  }
  if (referralReward) {
    if (!referralReward.pending) {
      try {
        const inviter = await userRepository.findByTelegramId(referralReward.inviterTelegramId);
        if (inviter) await vpnService.getPaidKey(inviter);
      } catch (error) {
        logger.error("Failed to provision paid VPN referral reward", {
          referralId: referralReward.referralId,
          error,
        });
      }
    }
    try {
      await ctx.telegram.sendMessage(
        Number(referralReward.inviterTelegramId),
        buildVpnReferralRewardText(referralReward.pending),
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("Открыть VPN", "vpn_status")]]),
        },
      );
    } catch (error) {
      logger.warn("Failed to notify paid VPN referral inviter", {
        referralId: referralReward.referralId,
        error,
      });
    }
  }
  if (result.duplicate) {
    logger.info("Duplicate paid VPN Stars payment ignored", {
      userId: ctx.dbUser.id,
      paymentId: result.payment.id,
    });
    return;
  }

  logger.info("Paid VPN Stars payment confirmed", {
    userId: ctx.dbUser.id,
    paymentId: result.payment.id,
    billingSubscriptionId: result.billingSubscription.id,
    isFirstRecurring: result.payment.isFirstRecurring,
  });
  if (
    result.subscription.accessOverride === VpnSubscriptionAccessOverride.FREE_UNLIMITED ||
    ctx.dbUser.clubStatus === ClubMembershipStatus.MEMBER
  ) {
    await ctx.reply(PAID_VPN_PAYMENT_BANKED_TEXT, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("Открыть VPN", "vpn_status")]]),
    });
    return;
  }
  try {
    const key = await vpnService.getPaidKey(ctx.dbUser);
    if (!key) throw new Error("Paid VPN key was not provisioned");
    await ctx.reply(
      buildPaidVpnPaymentReadyText(
        result.subscription.expiresAt ?? result.payment.subscriptionExpirationDate,
        !result.payment.isFirstRecurring,
      ),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("Открыть VPN", "vpn_status")]]),
      },
    );
  } catch (error) {
    logger.error("Paid VPN provisioning failed after confirmed Stars payment", {
      userId: ctx.dbUser.id,
      paymentId: result.payment.id,
      error,
    });
    await ctx.reply(PAID_VPN_PROVISIONING_ERROR_TEXT, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Проверить снова", "vpn_status")],
        [Markup.button.callback("Поддержка", VPN_SUPPORT_ACTION)],
      ]),
    });
  }
}

export function extractBotSubscriptionUpdate(ctx: PaidVpnContext): BotSubscriptionUpdated | null {
  const update = ctx.update as unknown as { subscription?: BotSubscriptionUpdated };
  return update.subscription ?? null;
}

export async function paidVpnSubscriptionUpdatedHandler(ctx: PaidVpnContext): Promise<void> {
  const update = extractBotSubscriptionUpdate(ctx);
  if (!update) return;
  const saved = await vpnBillingService.updateTelegramSubscriptionState({
    telegramId: BigInt(update.user.id),
    invoicePayload: update.invoice_payload,
    state: update.state,
    occurredAt: new Date(),
  });
  if (!saved) {
    logger.warn("Unknown paid VPN subscription update ignored", {
      userId: ctx.dbUser.id,
      state: update.state,
    });
    return;
  }
  logger.info("Paid VPN subscription state updated", {
    userId: ctx.dbUser.id,
    billingSubscriptionId: saved.id,
    state: update.state,
  });
  if (update.state === "failed" && !ctx.dbUser.isBanned && !ctx.dbUser.vpnBlocked) {
    await ctx.telegram.sendMessage(
      update.user.id,
      [
        "<b>Не прошло продление МОЖНО VPN</b>",
        "",
        "Новых списаний не было. VPN работает до конца уже оплаченного срока.",
        "",
        "Открой VPN, чтобы проверить дату и доступ.",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Проверить VPN", "vpn_status")],
          [Markup.button.callback("Поддержка", VPN_SUPPORT_ACTION)],
        ]),
      },
    );
  }
}

export async function paidVpnCancelHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  const billingSubscription = await vpnBillingService.findCancelable(ctx.dbUser.id);
  if (!billingSubscription || !billingSubscription.vpnSubscription.expiresAt) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }
  await editCallbackMessage(
    ctx,
    buildPaidVpnCancelConfirmationText(billingSubscription.vpnSubscription.expiresAt),
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Оставить продление", "vpn_status")],
        [Markup.button.callback("Отключить продление", "vpn_cancel_confirm")],
      ]),
    },
  );
}

export async function paidVpnCancelConfirmHandler(ctx: PaidVpnContext): Promise<void> {
  await ctx.answerCbQuery();
  const billingSubscription = await vpnBillingService.findCancelable(ctx.dbUser.id);
  const chargeId = billingSubscription?.telegramSubscriptionChargeId;
  if (!billingSubscription || !chargeId || !ctx.from?.id) {
    await showPaidVpnScreen(ctx, { answerCallback: false });
    return;
  }
  const request: EditUserStarSubscriptionRequest = {
    user_id: ctx.from.id,
    telegram_payment_charge_id: chargeId,
    is_canceled: true,
  };
  await (ctx.telegram as unknown as RawTelegramApi).callApi(
    "editUserStarSubscription",
    request as unknown as Record<string, unknown>,
  );
  await vpnBillingService.markCanceled(billingSubscription.id);
  logger.info("Paid VPN Stars renewal canceled", {
    userId: ctx.dbUser.id,
    billingSubscriptionId: billingSubscription.id,
  });
  await showPaidVpnScreen(ctx, { answerCallback: false });
}

export async function paidVpnTermsHandler(ctx: PaidVpnContext): Promise<void> {
  const rows: InlineKeyboardButton[][] = config.vpnBot.payments.termsUrl
    ? [[Markup.button.url("Открыть условия", config.vpnBot.payments.termsUrl)]]
    : [];
  rows.push([Markup.button.callback("Поддержка", VPN_SUPPORT_ACTION)]);
  await ctx.reply(buildPaidVpnTermsText(config.vpnBot.payments.termsUrl), {
    ...Markup.inlineKeyboard(rows),
  });
}
