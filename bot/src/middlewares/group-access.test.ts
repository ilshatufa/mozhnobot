import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyClubDeparture,
  clubDepartureNotification,
  shouldDeleteMembershipServiceMessage,
  type MembershipServiceMessageLike,
} from "./group-access.js";
import type { ChatMemberUpdateLike } from "../services/group-access.service.js";

const CLUB_CHAT_ID = "-1003393970920";
const BERLIN_CHAT_ID = "-1003774482834";
const MEMBER_ID = 2002;
const MOZHNOBOT_ID = 8423623216;

function memberUpdate(
  newStatus: "left" | "kicked",
  actor: ChatMemberUpdateLike["from"],
  oldStatus = "member",
): ChatMemberUpdateLike {
  return {
    chat: { id: Number(CLUB_CHAT_ID) },
    date: 1_789_164_000,
    from: actor,
    old_chat_member: {
      status: oldStatus,
      user: { id: MEMBER_ID, username: "member_name", first_name: "Имя" },
    },
    new_chat_member: {
      status: newStatus,
      user: { id: MEMBER_ID, username: "member_name", first_name: "Имя" },
    },
  };
}

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
      serviceMessage({ chat: { id: Number(CLUB_CHAT_ID) } }),
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
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    true,
  );
});

test("recognizes a member removal message in another managed group", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage(),
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    true,
  );
});

test("recognizes a member join message in another managed group", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({
        left_chat_member: undefined,
        new_chat_members: [{ id: 3003 }],
      }),
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    true,
  );
});

test("keeps service messages outside managed groups", () => {
  assert.equal(
    shouldDeleteMembershipServiceMessage(
      serviceMessage({ chat: { id: -1009999999999 } }),
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
      CLUB_CHAT_ID,
      [BERLIN_CHAT_ID],
    ),
    false,
  );
});

test("classifies a voluntary departure", () => {
  const update = memberUpdate("left", { id: MEMBER_ID, username: "member_name" });
  assert.equal(classifyClubDeparture(update, MOZHNOBOT_ID), "self");
  assert.match(clubDepartureNotification(update, "self"), /Вышел из клуба сам/);
});

test("classifies removals by Tribute, MozhnoBot and Clubni", () => {
  assert.equal(
    classifyClubDeparture(memberUpdate("kicked", { id: 6675346585, username: "tribute" }), MOZHNOBOT_ID),
    "tribute",
  );
  assert.equal(
    classifyClubDeparture(memberUpdate("kicked", { id: MOZHNOBOT_ID, username: "MozhnoClub_Bot" }), MOZHNOBOT_ID),
    "mozhno",
  );
  assert.equal(
    classifyClubDeparture(memberUpdate("kicked", { id: 9001, username: "we_clubni_bot" }), MOZHNOBOT_ID),
    "clubni",
  );
});

test("names another remover and ignores the second kicked-to-left update", () => {
  const removedByAdmin = memberUpdate("kicked", { id: 9002, username: "admin_name" });
  assert.equal(classifyClubDeparture(removedByAdmin, MOZHNOBOT_ID), "other");
  assert.match(clubDepartureNotification(removedByAdmin, "other"), /@admin_name/);

  const duplicate = memberUpdate(
    "left",
    { id: 6675346585, username: "tribute" },
    "kicked",
  );
  assert.equal(classifyClubDeparture(duplicate, MOZHNOBOT_ID), null);
});
