import { Markup } from "telegraf";
import { type AuthContext } from "../middlewares/auth.js";
import { clubInterestRepository } from "../repositories/club-interest.repository.js";
import { CLUB_WAITLIST_ACTION } from "./club-interest.js";
import { getHelpText } from "./help.js";

export async function startHandler(ctx: AuthContext): Promise<void> {
  if (!ctx.isClubMember) {
    await clubInterestRepository.recordOpened(ctx.dbUser.id);
    await ctx.reply(
      "Сейчас клуб закрыт для вступления.\nМожно записаться в лист ожидания.",
      Markup.inlineKeyboard([
        Markup.button.callback("Записаться в лист ожидания", CLUB_WAITLIST_ACTION),
      ]),
    );
    return;
  }

  const name = ctx.dbUser.firstName ?? ctx.dbUser.username ?? "участник";

  const text = `Добро пожаловать, ${name}!\n\n${getHelpText(ctx)}`;

  await ctx.reply(text);
}
