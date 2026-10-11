import assert from "node:assert/strict";
import test from "node:test";
import { ClubMembershipStatus } from "@prisma/client";
import {
  botInboxHeader,
  clubMembershipLabel,
  shouldCopyToBotInbox,
} from "./bot-inbox.js";

test("labels current, former and never-members distinctly", () => {
  assert.equal(clubMembershipLabel({ clubStatus: ClubMembershipStatus.MEMBER, joinedAt: new Date() }), "есть");
  assert.equal(clubMembershipLabel({ clubStatus: ClubMembershipStatus.REMOVED, joinedAt: new Date() }), "был(а)");
  assert.equal(clubMembershipLabel({ clubStatus: ClubMembershipStatus.UNKNOWN, joinedAt: null }), "нет");
});

test("header includes username, name and membership", () => {
  assert.equal(
    botInboxHeader(
      { id: 42, username: "reader", first_name: "Ирина", last_name: "Ильина" },
      { clubStatus: ClubMembershipStatus.MEMBER, joinedAt: new Date() },
    ),
    "Пользователь: @reader · Ирина Ильина\nВ клубе: есть",
  );
  assert.equal(
    botInboxHeader(
      { id: 42, username: "reader", first_name: "Ирина" },
      { clubStatus: ClubMembershipStatus.UNKNOWN, joinedAt: null },
      true,
    ),
    "Пользователь: @reader · Ирина\nВ клубе: нет\nТег: #онбординг",
  );
});

test("copies user content but skips commands and unsupported media", () => {
  assert.equal(shouldCopyToBotInbox({ message_id: 1, date: 1, chat: {} as never, text: "Привет" } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 2, date: 1, chat: {} as never, text: "/start" } as never), false);
  assert.equal(shouldCopyToBotInbox({ message_id: 3, date: 1, chat: {} as never, voice: {} } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 4, date: 1, chat: {} as never, video_note: {} } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 5, date: 1, chat: {} as never, photo: [] } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 6, date: 1, chat: {} as never, video: {} } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 7, date: 1, chat: {} as never, document: {} } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 8, date: 1, chat: {} as never, location: {} } as never), false);
});
