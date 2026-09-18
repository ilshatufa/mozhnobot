import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNoRemovableAccessText,
  buildPaidVpnActiveText,
  buildPaidVpnConfirmationText,
  buildPaidVpnInvoiceReadyText,
  buildPaidVpnClubAccessText,
  buildPaidVpnReferralText,
  buildPaidVpnSupportAdminReplyPrompt,
  buildPaidVpnSupportAdminText,
  buildPaidVpnStarsHelpText,
  buildPaidVpnFreeAccessText,
  buildPaidVpnOfferText,
  buildPaidVpnTrialActiveText,
  buildPaidVpnAccessRemovedText,
  buildPendingAccessSavedText,
  buildPendingAccessRemovedText,
  PAID_VPN_NO_ACCESS_TEXT,
  PAID_VPN_INVOICE_ERROR_TEXT,
  PAID_VPN_PENDING_ACCESS_ERROR_TEXT,
  PAID_VPN_PENDING_ACCESS_READY_TEXT,
  PAID_VPN_PREMIUM_BOT_URL,
  PAID_VPN_START_TEXT,
  PAID_VPN_SUPPORT_PROMPT_TEXT,
  parseAddUsername,
  parseGiftCommand,
  parseRemoveUsername,
} from "./paid-vpn-copy.js";

test("paid VPN start text explains payment and access purpose", () => {
  assert.match(PAID_VPN_START_TEXT, /личная ссылка/);
  assert.match(PAID_VPN_START_TEXT, /пробный период/);
});

test("paid VPN offer shows price, period, and automatic renewal before payment", () => {
  const text = buildPaidVpnOfferText({
    amountStars: 100,
    salesAvailable: true,
    trialAvailable: true,
  });
  assert.match(text, /100 ⭐/);
  assert.match(text, /30 дней/);
  assert.match(text, /прямо внутри Telegram/);
  assert.match(text, /автоматически/);
  assert.match(text, /7 дней бесплатно/);
  assert.match(text, /списаний не будет/);
  assert.match(text, /30 дней за друга/);
});

test("trial screen shows expiry, whitelist quota, and no charge", () => {
  const text = buildPaidVpnTrialActiveText({
    subscriptionUrl: "https://vpn.example.com/sub/private-token",
    endsAt: new Date("2026-09-24T12:00:00Z"),
    whitelistUsedBytes: 128n * 1024n ** 2n,
    whitelistLimitBytes: 1024n ** 3n,
  });
  assert.match(text, /Списаний не будет/);
  assert.match(text, /128 МБ из 1 ГБ/);
  assert.match(text, /Нидерланды, Германия и Латвия — без лимита/);
  assert.match(text, /Как подключиться/);
  assert.match(text, /30 дней за друга/);
  assert.doesNotMatch(text, /Если кнопка не сработает/);
});

test("purchase during trial explains that unused trial time is preserved", () => {
  const text = buildPaidVpnConfirmationText({ amountStars: 100, trialActive: true });
  assert.match(text, /Полный доступ включится сразу/);
  assert.match(text, /остаток.*сохранится/i);
});

test("referral screen states the 30 day reward and new-user condition", () => {
  const text = buildPaidVpnReferralText({
    referralUrl: "https://t.me/mozhno_vpn_bot?start=ref_example12",
    invited: 2,
    rewarded: 1,
  });
  assert.match(text, /30 дней/);
  assert.match(text, /нового пользователя/);
  assert.match(text, /Перешли по ссылке: 2/);
});

test("/gift parser accepts a username and bounded day count", () => {
  assert.deepEqual(parseGiftCommand("/gift @ilsh_at 30"), {
    ok: true,
    username: "ilsh_at",
    days: 30,
  });
  assert.deepEqual(parseGiftCommand("/gift @ilsh_at 0"), { ok: false });
  assert.deepEqual(parseGiftCommand("/gift @ilsh_at 3651"), { ok: false });
});

test("paid VPN confirmation explains current and recurring charge", () => {
  const text = buildPaidVpnConfirmationText({ amountStars: 100 });
  assert.match(text, /спишется сейчас/);
  assert.match(text, /каждые 30 дней/);
  assert.match(text, /прямо внутри Telegram/);
  assert.match(text, /@PremiumBot/);
  assert.match(text, /Перейти к оплате/);
});

test("invoice link screen always gives a visible payment action or recovery", () => {
  const text = buildPaidVpnInvoiceReadyText({ amountStars: 100 });
  assert.match(text, /Оплатить 100 ⭐/);
  assert.match(text, /прямо внутри Telegram/);
  assert.match(text, /После покупки вернись к этому сообщению/);
  assert.match(text, /@PremiumBot/);
  assert.match(PAID_VPN_INVOICE_ERROR_TEXT, /Попробуй ещё раз/);
  assert.match(PAID_VPN_INVOICE_ERROR_TEXT, /поддержку/);
});

test("PremiumBot purchase action uses the official bot link", () => {
  assert.equal(PAID_VPN_PREMIUM_BOT_URL, "https://t.me/PremiumBot");
});

test("Stars help explains the PremiumBot purchase and safe return", () => {
  const text = buildPaidVpnStarsHelpText({ amountStars: 100 });
  assert.match(text, /прямо внутри Telegram/);
  assert.match(text, /минимум на 100 ⭐/);
  assert.match(text, /только пополняет баланс/);
  assert.match(text, /Подписка VPN оплачивается отдельно/);
  assert.match(text, /Не вводи пароль или код/);
});

test("in-bot support copy explains the conversation and preserves safe identity data", () => {
  assert.match(PAID_VPN_SUPPORT_PROMPT_TEXT, /Ответ придёт сюда/);
  assert.match(PAID_VPN_SUPPORT_PROMPT_TEXT, /скриншот или документ/);

  const adminText = buildPaidVpnSupportAdminText({
    firstName: "Ильшат <тест>",
    username: "ilsh_at",
    telegramId: 123456789n,
    accessStatus: "оплачен до 17 октября",
  });
  assert.match(adminText, /Ильшат &lt;тест&gt;/);
  assert.match(adminText, /@ilsh_at/);
  assert.match(adminText, /123456789/);
  assert.match(adminText, /оплачен до 17 октября/);

  assert.match(buildPaidVpnSupportAdminReplyPrompt(123456789), /Telegram ID: <code>123456789<\/code>/);
});

test("paid VPN canceled state preserves the paid period and link", () => {
  const text = buildPaidVpnActiveText({
    subscriptionUrl: "https://vpn.example.com/sub/private-token",
    expiresAt: new Date("2026-10-17T12:00:00Z"),
    nextChargeAt: new Date("2026-10-10T12:00:00Z"),
    renewalState: "canceled",
  });
  assert.match(text, /Автопродление отключено/);
  assert.match(text, /Оплачено до/);
  assert.match(text, /лимит обновляется каждые 30 дней/);
  assert.match(text, /https:\/\/vpn\.example\.com\/sub\/private-token/);
  assert.match(text, /30 дней за друга/);
});

test("free VPN access still exposes an active paid renewal", () => {
  const text = buildPaidVpnFreeAccessText({
    subscriptionUrl: "https://vpn.example.com/sub/private-token",
    paidExpiresAt: new Date("2026-10-17T12:00:00Z"),
    nextChargeAt: new Date("2026-10-10T12:00:00Z"),
    renewalActive: true,
  });
  assert.match(text, /бесплатный доступ/);
  assert.match(text, /осталось автопродление/);
  assert.match(text, /отключи продление/);
  assert.match(text, /лимит обновляется каждые 30 дней/);
  assert.match(text, /30 дней за друга/);
});

test("club access warns about a paid renewal that is still active", () => {
  const text = buildPaidVpnClubAccessText({
    subscriptionUrl: "https://vpn.example.com/sub/club-token",
    renewalActive: true,
    nextChargeAt: new Date("2026-10-10T12:00:00Z"),
  });
  assert.match(text, /входит в клуб/);
  assert.match(text, /подписка всё ещё продлевается/);
  assert.match(text, /Следующее списание/);
  assert.match(text, /30 дней за друга/);
});

test("paid VPN no-access text gives the next action", () => {
  assert.match(PAID_VPN_NO_ACCESS_TEXT, /напиши в поддержку/);
});

test("pending grant copy explains automatic first-start activation", () => {
  const savedText = buildPendingAccessSavedText("leis_x");
  assert.match(savedText, /@leis_x/);
  assert.match(savedText, /впервые отправит \/start/);
  assert.match(savedText, /Повторять \/add не нужно/);
  assert.match(PAID_VPN_PENDING_ACCESS_READY_TEXT, /Отправь \/vpn/);
  assert.match(PAID_VPN_PENDING_ACCESS_ERROR_TEXT, /Отправь \/start ещё раз/);
});

test("/add parser accepts one valid Telegram username", () => {
  assert.deepEqual(parseAddUsername("/add @ilsh_at"), { ok: true, username: "ilsh_at" });
  assert.deepEqual(parseAddUsername("/add@mozhno_vpn_bot @User123"), {
    ok: true,
    username: "User123",
  });
});

test("/add parser rejects missing, short, and multiple usernames", () => {
  assert.deepEqual(parseAddUsername("/add"), { ok: false });
  assert.deepEqual(parseAddUsername("/add @abcd"), { ok: false });
  assert.deepEqual(parseAddUsername("/add @first_user @second_user"), { ok: false });
});

test("/remove parser accepts one valid Telegram username", () => {
  assert.deepEqual(parseRemoveUsername("/remove @leis_x"), { ok: true, username: "leis_x" });
  assert.deepEqual(parseRemoveUsername("/remove@mozhno_vpn_bot @User123"), {
    ok: true,
    username: "User123",
  });
});

test("/remove parser rejects missing and multiple usernames", () => {
  assert.deepEqual(parseRemoveUsername("/remove"), { ok: false });
  assert.deepEqual(parseRemoveUsername("/remove @first_user @second_user"), { ok: false });
});

test("remove copy distinguishes active, pending, and empty access", () => {
  assert.match(buildPaidVpnAccessRemovedText("leis_x"), /доступ.*отключён/i);
  assert.match(buildPendingAccessRemovedText("leis_x"), /Разрешение.*удалено/);
  assert.match(buildNoRemovableAccessText("leis_x"), /нет бесплатного доступа/);
});
