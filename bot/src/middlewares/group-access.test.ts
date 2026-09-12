import assert from "node:assert/strict";
import test from "node:test";
import {
  isOwnRemovalServiceMessage,
  type RemovalServiceMessageLike,
} from "./group-access.js";

const BOT_ID = 1001;
const BERLIN_CHAT_ID = "-1003774482834";

function removalMessage(overrides: Partial<RemovalServiceMessageLike> = {}) {
  return {
    message_id: 500,
    chat: { id: Number(BERLIN_CHAT_ID) },
    from: { id: BOT_ID },
    left_chat_member: { id: 2002 },
    ...overrides,
  };
}

test("recognizes only the bot's own removal message in a managed group", () => {
  assert.equal(
    isOwnRemovalServiceMessage(removalMessage(), BOT_ID, [BERLIN_CHAT_ID]),
    true,
  );
});

test("keeps a removal message created by another administrator", () => {
  assert.equal(
    isOwnRemovalServiceMessage(
      removalMessage({ from: { id: 3003 } }),
      BOT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});

test("keeps service messages outside managed groups", () => {
  assert.equal(
    isOwnRemovalServiceMessage(
      removalMessage({ chat: { id: -1009999999999 } }),
      BOT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});

test("keeps ordinary messages from the bot", () => {
  assert.equal(
    isOwnRemovalServiceMessage(
      removalMessage({ left_chat_member: undefined }),
      BOT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});
