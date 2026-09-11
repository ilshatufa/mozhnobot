import { type AuthContext } from "../middlewares/auth.js";
import {
  clubInterestRepository,
  type WaitlistedClubUser,
} from "../repositories/club-interest.repository.js";

const TELEGRAM_MESSAGE_LIMIT = 3900;
const WAITLIST_TIME_ZONE = "Asia/Yekaterinburg";

const waitlistDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: WAITLIST_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatIdentity(entry: WaitlistedClubUser): string {
  const username = entry.user.username ? `@${entry.user.username}` : null;
  const firstName = entry.user.firstName?.trim() || null;

  if (username && firstName) return `${username} — ${firstName}`;
  if (username) return username;
  if (firstName) return firstName;
  return `Telegram ID ${entry.user.telegramId}`;
}

function formatEntry(entry: WaitlistedClubUser, position: number): string {
  const date = waitlistDateFormatter.format(entry.waitlistedAt).replace(",", "");
  return [
    `${position}. ${formatIdentity(entry)}`,
    `ID ${entry.user.telegramId} · ${date} ЕКБ`,
  ].join("\n");
}

export function buildWaitlistMessages(entries: WaitlistedClubUser[]): string[] {
  if (entries.length === 0) return ["Пока никто не записался в МожноКлуб."];

  const header = `Записались в МожноКлуб: ${entries.length}\nВремя записи — ЕКБ.`;
  const messages: string[] = [];
  let current = header;

  entries.forEach((entry, index) => {
    const block = formatEntry(entry, index + 1);
    const candidate = `${current}\n\n${block}`;

    if (candidate.length > TELEGRAM_MESSAGE_LIMIT) {
      messages.push(current);
      current = block;
      return;
    }

    current = candidate;
  });

  messages.push(current);
  return messages;
}

export async function waitlistAdminHandler(ctx: AuthContext): Promise<void> {
  const entries = await clubInterestRepository.findAllWaitlisted();

  for (const message of buildWaitlistMessages(entries)) {
    await ctx.reply(message);
  }
}
