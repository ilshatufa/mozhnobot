import assert from "node:assert/strict";
import test from "node:test";
import {
  PAID_VPN_NO_ACCESS_TEXT,
  PAID_VPN_START_TEXT,
  parseAddUsername,
} from "./paid-vpn-copy.js";

test("paid VPN start text points to /vpn and does not promise immediate paid access", () => {
  assert.match(PAID_VPN_START_TEXT, /\/vpn/);
  assert.match(PAID_VPN_START_TEXT, /Платная подписка появится позже/);
});

test("paid VPN no-access text gives the next action", () => {
  assert.match(PAID_VPN_NO_ACCESS_TEXT, /напиши администратору/);
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
