import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNoRemovableAccessText,
  buildPaidVpnAccessRemovedText,
  buildPendingAccessSavedText,
  buildPendingAccessRemovedText,
  PAID_VPN_NO_ACCESS_TEXT,
  PAID_VPN_PENDING_ACCESS_ERROR_TEXT,
  PAID_VPN_PENDING_ACCESS_READY_TEXT,
  PAID_VPN_START_TEXT,
  parseAddUsername,
  parseRemoveUsername,
} from "./paid-vpn-copy.js";

test("paid VPN start text points to /vpn and does not promise immediate paid access", () => {
  assert.match(PAID_VPN_START_TEXT, /\/vpn/);
  assert.match(PAID_VPN_START_TEXT, /Платная подписка появится позже/);
});

test("paid VPN no-access text gives the next action", () => {
  assert.match(PAID_VPN_NO_ACCESS_TEXT, /напиши администратору/);
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
