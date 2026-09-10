import assert from "node:assert/strict";
import test from "node:test";
import { type AuthContext } from "../middlewares/auth.js";
import { clubInterestRepository } from "../repositories/club-interest.repository.js";
import {
  AVITO_GUIDE_TEXT,
  CLUB_AVITO_GUIDE_ACTION,
  avitoGuideHandler,
  waitlistHandler,
} from "./club-interest.js";

test("waitlist confirmation offers the Avito guide", async (t) => {
  const originalRecordWaitlisted = clubInterestRepository.recordWaitlisted;
  clubInterestRepository.recordWaitlisted = async () => {};
  t.after(() => {
    clubInterestRepository.recordWaitlisted = originalRecordWaitlisted;
  });

  let callbackAnswered = false;
  let editedText = "";
  let editedExtra: unknown;

  const ctx = {
    answerCbQuery: async () => {
      callbackAnswered = true;
    },
    dbUser: { id: 1 },
    editMessageText: async (text: string, extra: unknown) => {
      editedText = text;
      editedExtra = extra;
    },
    isClubMember: false,
  } as unknown as AuthContext;

  await waitlistHandler(ctx);

  assert.equal(callbackAnswered, true);
  assert.equal(
    editedText,
    "спасибо, вот тебе методичка нашего клуба «Все фишки Авито»",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(editedExtra)), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            callback_data: CLUB_AVITO_GUIDE_ACTION,
            hide: false,
            text: "получить",
          },
        ],
      ],
    },
  });
});

test("Avito guide is sent as a separate linked message", async () => {
  let callbackAnswered = false;
  let replyText = "";
  let replyExtra: unknown;

  const ctx = {
    answerCbQuery: async () => {
      callbackAnswered = true;
    },
    reply: async (text: string, extra: unknown) => {
      replyText = text;
      replyExtra = extra;
    },
  } as unknown as AuthContext;

  await avitoGuideHandler(ctx);

  assert.equal(callbackAnswered, true);
  assert.equal(replyText, AVITO_GUIDE_TEXT);
  assert.deepEqual(replyExtra, {
    link_preview_options: { is_disabled: true },
    parse_mode: "HTML",
  });
  assert.ok(replyText.length <= 4096);
  assert.equal((replyText.match(/https:\/\/teletype\.in\/@mozhno_club\//g) ?? []).length, 5);
  assert.match(replyText, /^<b>Авито: .*🔥<\/b>/);

  for (const path of [
    "avito_denezh_trenazher",
    "avito_item_card",
    "avito_item_price",
    "avito_dostavka",
    "avito_challenge",
  ]) {
    assert.match(replyText, new RegExp(`https://teletype\\.in/@mozhno_club/${path}`));
  }
});
