import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesReportMarkdown, type SalesReport } from "./sales-report.js";

test("formats sales totals and paid users without membership as rich markdown", () => {
  const report: SalesReport = {
    startedAt: new Date("2026-10-11T18:36:23.000Z"),
    delivered: 30,
    paid: 4,
    paidAndJoined: 2,
    paidWithoutMembership: [
      {
        telegramId: 123n,
        username: "test_user",
        firstName: "Катя",
        lastName: "Тестова",
        paidAt: new Date("2026-10-12T05:22:08.000Z"),
      },
      {
        telegramId: 456n,
        username: null,
        firstName: "Анна",
        lastName: null,
        paidAt: new Date("2026-10-12T06:00:00.000Z"),
      },
    ],
    onboardingStarted: 4,
    onboardingAnswered: 3,
    onboardingAccessGranted: 2,
    onboardingCompleted: 2,
  };

  const markdown = buildSalesReportMarkdown(report);

  assert.match(markdown, /\*\*Получили рассылку:\*\* 30/);
  assert.match(markdown, /\*\*Оплатили, но не вступили:\*\* 2/);
  assert.match(markdown, /\[@test_user · Катя Тестова\]\(https:\/\/t\.me\/test_user\)/);
  assert.match(markdown, /\[Анна\]\(tg:\/\/user\?id=456\)/);
  assert.match(markdown, /12 октября 2026 г\\\. в 10:22/);
});
