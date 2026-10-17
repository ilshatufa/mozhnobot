import assert from "node:assert/strict";
import test from "node:test";
import {
  CLUB_SALES_CLOSES_AT,
  CLUB_SALES_START_MARKDOWN,
  CLUB_SALES_WAITLIST_MARKDOWN,
  isClubSalesOpen,
} from "./club-sales.js";

test("sales window remains open through the announced Moscow deadline", () => {
  assert.equal(isClubSalesOpen(CLUB_SALES_CLOSES_AT), true);
  assert.equal(isClubSalesOpen(new Date("2026-10-18T21:00:00.000Z")), false);
});

test("sales messages contain the deadline and all entry options", () => {
  for (const message of [CLUB_SALES_START_MARKDOWN, CLUB_SALES_WAITLIST_MARKDOWN]) {
    assert.match(message, /18 октября, 23:59:59/);
    assert.match(message, /we_clubni_bot/);
    assert.match(message, /your_clubni_bot/);
    assert.match(message, /mozhno_vpn_bot/);
  }
});

test("waitlist sales message keeps a visible spacer before the primary entry link", () => {
  assert.match(CLUB_SALES_WAITLIST_MARKDOWN, /видеть тебя внутри!\n\n⠀\n\n\[🔥 ВОЙТИ В КЛУБ/);
});
