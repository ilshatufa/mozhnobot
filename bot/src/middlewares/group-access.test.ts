import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldDeleteMembershipServiceMessage,
  type MembershipServiceMessageLike,
} from "./group-access.js";

const BOT_ID = 1001;
const CLUB_CHAT_ID = "-1003393970920";
const BERLIN_CHAT_ID = "-1003774482834";

function serviceMessage(overrides: Partial<MembershipServiceMessageLike> = {}) {
  return {
    message_id: 500,
    chat: { id: Number(BERLIN_CHAT_ID) },
    left_chat_member: { id: 2002 },
    ...overrides,
  };
}

test("recognizes a member removal message in the club group", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({ chat: { id: Number(CLUB_CHAT_ID) }, from: { id: 3003 } }),
      BOT_ID,
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    true,
  );
});

test("recognizes a member join message in the club group", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({
        chat: { id: Number(CLUB_CHAT_ID) },
        left_chat_member: undefined,
        new_chat_members: [{ id: 3003 }],
      }),
      BOT_ID,
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    true,
  );
});

test("keeps deleting the bot's own removal message in another managed group", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({ from: { id: BOT_ID } }),
      BOT_ID,
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    true,
  );
});

test("keeps other membership messages in another managed group", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({ from: { id: 3003 } }),
      BOT_ID,
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});

test("keeps service messages outside managed groups", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({ chat: { id: -1009999999999 } }),
      BOT_ID,
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});

test("keeps ordinary messages", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({ left_chat_member: undefined }),
      BOT_ID,
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});
