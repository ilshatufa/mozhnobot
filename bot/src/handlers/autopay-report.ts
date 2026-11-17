import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { AuthContext } from "../middlewares/auth.js";

const reportSchema = z.object({
  generatedAt: z.string().datetime(),
  people: z.array(z.object({
    telegramId: z.string().regex(/^\d+$/),
    name: z.string(),
    username: z.string().nullable(),
    attempts: z.number().int().positive(),
    accessUntil: z.string().datetime(),
  }).strict()),
}).strict();

export type AutopayReport = z.infer<typeof reportSchema>;

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", day: "numeric", month: "long",
});
const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const escape = (value: string) => value.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");

export function buildAutopayReportMarkdown(report: AutopayReport): string {
  const generatedAt = new Date(report.generatedAt);
  const heading = `# МОЖНО · Проблемы с автопродлением\n\nДанные на ${escape(dateFormatter.format(generatedAt))}, ${timeFormatter.format(generatedAt)} МСК`;
  if (report.people.length === 0) return `${heading}\n\nПроблем с автопродлением нет.`;
  const table = [
    "| Участник | Telegram | Доступ до |",
    "| :--- | :--- | :--- |",
    ...report.people.map(person => {
      const contact = person.username
        ? `[@${escape(person.username)}](https://t.me/${person.username})`
        : `ID ${person.telegramId}`;
      const accessUntil = new Date(person.accessUntil);
      return `| ${escape(person.name)} (${person.attempts}) | ${contact} | ${escape(dateFormatter.format(accessUntil))}<br/>${timeFormatter.format(accessUntil)} МСК |`;
    }),
  ].join("\n");
  return [heading, `Участников: **${report.people.length}**`, table,
    "Показаны неуспешные продления с включённым автопродлением и действующим льготным доступом.",
    "В скобках рядом с именем указано количество попыток списания."]
    .join("\n\n\u2800\n\n");
}

export async function autopayReportHandler(ctx: AuthContext): Promise<void> {
  if (!config.botInboxGroupId || String(ctx.chat?.id) !== config.botInboxGroupId) {
    await ctx.reply("Команда /autopay доступна только в админской группе МожноБота.");
    return;
  }
  let report: AutopayReport;
  try {
    if (!config.clubniSalesReport.enabled) throw new Error("Clubni reporting is not configured");
    const url = new URL("/internal/autopay-problems", config.clubniSalesReport.url);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.clubniSalesReport.token}` },
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`Clubni autopay report returned ${response.status}`);
    report = reportSchema.parse(await response.json());
  } catch (error) {
    logger.error("Failed to load autopay report", { error: error instanceof Error ? error.message : String(error) });
    await ctx.reply("Не удалось получить данные Clubni. Повторите /autopay позже.");
    return;
  }
  await ctx.telegram.callApi("sendRichMessage" as never, {
    chat_id: ctx.chat!.id, rich_message: { markdown: buildAutopayReportMarkdown(report) },
  } as never);
}
