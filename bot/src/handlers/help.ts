import { type Role } from "@prisma/client";
import { type AuthContext } from "../middlewares/auth.js";

function buildHelpText(role: Role): string {
  const isAdmin = role === "ADMIN";

  let text = "Команды бота\n\n";
  text += "Основные:\n";
  text += "/help — показать список команд\n";
  text += "/vpn — получить VPN-ключ\n";
  text += "/status — проверить статус VPN-ключа\n";

  if (isAdmin) {
    text += "\nАдминистрирование пользователей:\n";
    text += "/users — список пользователей\n";
    text += "/block <id или @user> — заблокировать VPN пользователю\n";
    text += "/unblock <id или @user> — разблокировать VPN пользователю\n";
    text += "/ban <id или @user> — заблокировать пользователя в боте\n";
    text += "/unban <id или @user> — разблокировать пользователя в боте\n";
    text += "/promote <id или @user> — назначить пользователя админом\n";

    text += "\nАналитика клуба:\n";
    text += "/stats — статистика событий клуба за 7 дней\n";

    text += "\nНастройки бота:\n";
    text += "/transcription_on — включить обработку голосовых и аудио\n";
    text += "/transcription_off — выключить обработку голосовых и аудио\n";
    text += "/transcription_status — проверить статус транскрибации\n";
  }

  return text;
}

export function getHelpText(ctx: AuthContext): string {
  return buildHelpText(ctx.dbUser.role);
}

export async function helpHandler(ctx: AuthContext): Promise<void> {
  await ctx.reply(getHelpText(ctx));
}
