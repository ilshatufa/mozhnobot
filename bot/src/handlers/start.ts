import { type AuthContext } from "../middlewares/auth.js";

export async function startHandler(ctx: AuthContext): Promise<void> {
  const name = ctx.dbUser.firstName ?? ctx.dbUser.username ?? "участник";
  const isAdmin = ctx.dbUser.role === "ADMIN";

  let text = `Добро пожаловать, ${name}!\n\n`;
  text += "Доступные команды:\n";
  text += "/vpn — получить VPN-ключ\n";
  text += "/status — статус вашего VPN-ключа\n";

  if (isAdmin) {
    text += "\nАдмин-команды:\n";
    text += "/block <id или @user> — заблокировать VPN\n";
    text += "/unblock <id или @user> — разблокировать VPN\n";
    text += "/ban <id или @user> — забанить в боте\n";
    text += "/unban <id или @user> — разбанить\n";
    text += "/promote <id или @user> — назначить админом\n";
    text += "/users — список пользователей\n";
  }

  await ctx.reply(text);
}
