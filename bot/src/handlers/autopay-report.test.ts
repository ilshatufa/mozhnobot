import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildAutopayReportMarkdown, autopayReportHandler, type AutopayReport } from "./autopay-report.js";
import { config } from "../config.js";
import type { AuthContext } from "../middlewares/auth.js";

const report: AutopayReport = {
  generatedAt: "2026-11-17T07:00:00.000Z",
  people: [{ telegramId: "123", name: "Анна | [тест]", username: "anna_test", attempts: 3,
    accessUntil: "2026-11-20T03:44:00.000Z" },
  { telegramId: "456", name: "Мария", username: null, attempts: 1, accessUntil: "2026-11-21T22:00:00.000Z" }],
};
const originalFetch = globalThis.fetch;
const originalGroup = config.botInboxGroupId;
const originalIntegration = { ...config.clubniSalesReport };
afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config, { botInboxGroupId: originalGroup });
  Object.assign(config.clubniSalesReport, originalIntegration);
});

test("rich table preserves all people, attempts, escaped names, contacts and Moscow deadlines without amounts", () => {
  const text = buildAutopayReportMarkdown(report);
  assert.match(text, /\| Участник \| Telegram \| Доступ до \|/);
  assert.ok(text.includes("Анна \\| \\[тест\\] (3)"));
  assert.ok(text.includes("| Мария (1) |"));
  assert.ok(text.endsWith("В скобках рядом с именем указано количество попыток списания."));
  assert.ok(text.includes("https://t.me/anna_test"));
  assert.match(text, /ID 456/);
  assert.ok(text.includes("20 ноября<br/>06:44 МСК"));
  assert.ok(text.includes("22 ноября<br/>01:00 МСК"));
  assert.equal(text.split("\n").filter(line => line.startsWith("| ")).length, 4);
  assert.doesNotMatch(text, /₽|руб|Сумма|Попыток списания|2026/);
});

test("uses an unpadded day, Russian month name and a separate Moscow time line", () => {
  const text = buildAutopayReportMarkdown({ ...report, people: [{ ...report.people[0],
    accessUntil: "2026-07-05T09:05:00.000Z" }] });
  assert.ok(text.includes("5 июля<br/>12:05 МСК"));
  assert.doesNotMatch(text, /05 июля|05\.07/);
});

test("empty report explains the result without an empty table", () => {
  const text = buildAutopayReportMarkdown({ ...report, people: [] });
  assert.match(text, /Проблем с автопродлением нет/);
  assert.doesNotMatch(text, /\| Участник/);
});

function context(chatId = -100555) {
  const replies: string[] = [];
  const sent: unknown[] = [];
  const ctx = { chat: { id: chatId }, reply: async (text: string) => { replies.push(text); },
    telegram: { callApi: async (...args: unknown[]) => { sent.push(args); } } } as unknown as AuthContext;
  return { ctx, replies, sent };
}

test("command loads fresh authenticated data every time and sends a rich table to the configured group", async () => {
  Object.assign(config, { botInboxGroupId: "-100555" });
  Object.assign(config.clubniSalesReport, { enabled: true, url: "https://clubni.test/internal/sales-funnel", token: "test-token" });
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://clubni.test/internal/autopay-problems");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    requests++;
    return Response.json(requests === 1 ? report : { ...report, people: [] });
  };
  const { ctx, sent } = context();
  await autopayReportHandler(ctx);
  await autopayReportHandler(ctx);
  assert.equal(requests, 2);
  assert.equal(sent.length, 2);
  assert.match(JSON.stringify(sent[0]), /sendRichMessage/);
  assert.match(JSON.stringify(sent[1]), /Проблем с автопродлением нет/);
});

test("other chats cannot fetch data; failed or invalid API replies never send a stale table", async () => {
  Object.assign(config, { botInboxGroupId: "-100555" });
  Object.assign(config.clubniSalesReport, { enabled: true, url: "https://clubni.test/internal/sales-funnel", token: "test-token" });
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({}, { status: 503 }); };
  const other = context(-100999);
  await autopayReportHandler(other.ctx);
  assert.equal(requests, 0);
  assert.equal(other.sent.length, 0);
  const failure = context();
  await autopayReportHandler(failure.ctx);
  assert.equal(failure.sent.length, 0);
  assert.match(failure.replies[0], /Не удалось получить данные/);
  globalThis.fetch = async () => Response.json({ ...report, amount: "secret" });
  await autopayReportHandler(failure.ctx);
  assert.equal(failure.sent.length, 0);
});
