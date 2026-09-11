import assert from "node:assert/strict";
import test from "node:test";
import { buildWaitlistMessages } from "./waitlist-admin.js";

test("renders all waitlisted users from newest to oldest", () => {
  const messages = buildWaitlistMessages([
    {
      waitlistedAt: new Date("2026-09-11T15:45:00.000Z"),
      user: { telegramId: 101n, username: "natasha", firstName: "Наташа" },
    },
    {
      waitlistedAt: new Date("2026-09-10T06:10:00.000Z"),
      user: { telegramId: 202n, username: null, firstName: "Иван" },
    },
  ]);

  assert.deepEqual(messages, [
    [
      "Записались в МожноКлуб: 2",
      "Время записи — ЕКБ.",
      "",
      "1. @natasha — Наташа",
      "ID 101 · 11.09.2026 20:45 ЕКБ",
      "",
      "2. Иван",
      "ID 202 · 10.09.2026 11:10 ЕКБ",
    ].join("\n"),
  ]);
});

test("explains an empty waitlist", () => {
  assert.deepEqual(buildWaitlistMessages([]), ["Пока никто не записался в МожноКлуб."]);
});

test("splits a long waitlist only between user records", () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    waitlistedAt: new Date("2026-09-11T15:45:00.000Z"),
    user: {
      telegramId: BigInt(1000 + index),
      username: `participant_${index}_${"x".repeat(24)}`,
      firstName: `Участник ${index} ${"я".repeat(30)}`,
    },
  }));

  const messages = buildWaitlistMessages(entries);

  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 3900));
  assert.equal(messages.join("\n\n").match(/ID \d+/g)?.length, 100);
});
