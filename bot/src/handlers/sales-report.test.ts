import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesReportMarkdown, type SalesReport } from "./sales-report.js";

test("formats sales totals and paid users without membership as rich markdown tables", () => {
  const report: SalesReport = {
    startedAt: new Date("2026-10-11T18:36:23.000Z"),
    delivered: 30,
    cohort: 36,
    notAuthorized: 10,
    authorizedNotStarted: 14,
    pending: 8,
    paid: 4,
    paidAndJoined: 2,
    paidWithoutMembership: [
      {
        telegramId: 123n,
        username: "test_user",
        firstName: "Катя",
        lastName: "Тестова",
        paidAt: new Date("2026-10-12T05:22:08.000Z"),
        wave: "волна 1",
      },
      {
        telegramId: 456n,
        username: null,
        firstName: "Анна",
        lastName: null,
        paidAt: new Date("2026-10-12T06:00:00.000Z"),
        wave: "волна 2",
      },
    ],
    onboardingStarted: 4,
    onboardingAnswered: 3,
    onboardingAccessGranted: 2,
    onboardingCompleted: 2,
  };

  const markdown = buildSalesReportMarkdown(report);

  assert.match(markdown, /\| Всего в воронке B1–B6 \| \*\*36\*\* \|/);
  assert.match(markdown, /\| Не авторизовались \| \*\*10\*\* \|/);
  assert.match(markdown, /\| Авторизовались, но не начали оформление \| \*\*14\*\* \|/);
  assert.match(markdown, /\| Ожидают оплату — pending \| \*\*8\*\* \|/);
  assert.match(markdown, /\| Оплатили, но не вступили \| \*\*2\*\* \|/);
  assert.match(markdown, /\| Конверсия в оплату \| \*\*11,1%\*\* \|/);
  assert.match(markdown, /\*\*Онбординг после оплаты\*\*/);
  assert.match(markdown, /\| Ответили на вопрос \| \*\*3\*\* \|/);
  assert.match(markdown, /\n\n⠀\n\n/);
  assert.match(markdown, /\[@test\\_user · Катя Тестова\]\(https:\/\/t\.me\/test_user\)/);
  assert.match(markdown, /\[Анна\]\(tg:\/\/user\?id=456\)/);
  assert.ok(markdown.includes(
    "| [@test\\_user · Катя Тестова](https://t.me/test_user) | 12 октября 2026 г\\. в 10:22 \\(волна 1\\) |",
  ));
  assert.doesNotMatch(markdown, /^# /m);
});

test("shows a compact empty state when every paying user joined", () => {
  const report: SalesReport = {
    startedAt: new Date("2026-10-11T18:36:23.000Z"),
    delivered: 30,
    cohort: 40,
    notAuthorized: 10,
    authorizedNotStarted: 14,
    pending: 8,
    paid: 8,
    paidAndJoined: 8,
    paidWithoutMembership: [],
    onboardingStarted: 8,
    onboardingAnswered: 8,
    onboardingAccessGranted: 8,
    onboardingCompleted: 8,
  };

  const markdown = buildSalesReportMarkdown(report);

  assert.match(markdown, /\*\*Оплатили, но не вступили · 0\*\*/);
  assert.match(markdown, /Все оплатившие вступили в клуб ✅/);
  assert.doesNotMatch(markdown, /\| Пользователь \| Дата оплаты \|/);
});
