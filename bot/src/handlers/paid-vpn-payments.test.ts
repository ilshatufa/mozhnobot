import assert from "node:assert/strict";
import test from "node:test";
import { VPN_SUBSCRIPTION_PERIOD_SECONDS } from "../services/vpn-billing.service.js";
import { buildPaidVpnSubscriptionInvoiceLinkRequest } from "./paid-vpn-payments.js";

test("recurring Stars payment is exported as an invoice link", () => {
  const request = buildPaidVpnSubscriptionInvoiceLinkRequest({
    invoicePayload: "invoice-payload",
    amountStars: 100,
  });

  assert.deepEqual(request, {
    title: "МОЖНО VPN — 30 дней",
    description: "Нидерланды, Германия и Латвия без лимита; белые списки — 10 ГБ. Автопродление каждые 30 дней.",
    payload: "invoice-payload",
    currency: "XTR",
    prices: [{ label: "МОЖНО VPN — 30 дней", amount: 100 }],
    subscription_period: VPN_SUBSCRIPTION_PERIOD_SECONDS,
  });
  assert.equal("chat_id" in request, false);
  assert.equal("provider_token" in request, false);
});
