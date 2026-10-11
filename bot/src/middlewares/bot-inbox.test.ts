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
});

test("copies text, voice and video notes but skips commands and other media", () => {
  assert.equal(shouldCopyToBotInbox({ message_id: 1, date: 1, chat: {} as never, text: "Привет" } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 2, date: 1, chat: {} as never, text: "/start" } as never), false);
  assert.equal(shouldCopyToBotInbox({ message_id: 3, date: 1, chat: {} as never, voice: {} } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 4, date: 1, chat: {} as never, video_note: {} } as never), true);
  assert.equal(shouldCopyToBotInbox({ message_id: 5, date: 1, chat: {} as never, photo: [] } as never), false);
});
