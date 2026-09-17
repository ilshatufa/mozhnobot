import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVpnSupportReplyAction,
  isVpnSupportUserPromptReply,
  parseVpnSupportAdminPromptTarget,
  parseVpnSupportReplyAction,
} from "./paid-vpn-support-flow.js";

test("support reply callback keeps the Telegram user id", () => {
  const action = buildVpnSupportReplyAction(123456789n);
  assert.equal(action, "vpn_support_reply:123456789");
  assert.equal(parseVpnSupportReplyAction(action), 123456789);
  assert.equal(parseVpnSupportReplyAction("vpn_support_reply:not-a-number"), null);
});

test("support prompts identify user and admin replies after a restart", () => {
  assert.equal(
    isVpnSupportUserPromptReply("Поддержка МОЖНО VPN\nОпиши проблему одним сообщением."),
    true,
  );
  assert.equal(
    parseVpnSupportAdminPromptTarget("Ответ пользователю\nTelegram ID: 123456789\nНапиши ответ."),
    123456789,
  );
  assert.equal(parseVpnSupportAdminPromptTarget("Обычное сообщение"), null);
});
