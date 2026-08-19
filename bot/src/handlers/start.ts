import { Markup } from "telegraf";
import { type AuthContext } from "../middlewares/auth.js";
import { clubInterestRepository } from "../repositories/club-interest.repository.js";
import { CLUB_WAITLIST_ACTION } from "./club-interest.js";
import { getHelpText } from "./help.js";

export async function startHandler(ctx: AuthContext): Promise<void> {
  if (!ctx.isClubMember) {
    await clubInterestRepository.recordOpened(ctx.dbUser.id);
    await ctx.reply(
      [
        "Привет! Спасибо за твой интерес к нашему клубу «МОЖНО», где мы каждый день в теплой обстановке находим возможность:",
        "🔘 переопыляться знаниями",
        "🔘 помогать в том, что знаем и умеем сами",
        "🔘 покупать и сдавать кладовки, шагать по 10 тыс шагов, разбарахляться на Авито и покупать ОФЗ - в общем, <b>строить свой капитал</b>, двигаясь маленькими шагами, чтобы спать спокойно и чувствовать себя уверенно)",
        "",
        "Сейчас вход в клуб закрыт, ближайшее окошко – в середине сентября 🤗",
        "",
        "Оставь заявку, и наш бот сообщит тебе об открытии окошка в клуб «МОЖНО» ⤵️",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback(
            "Жми кнопку, и мы напишем, когда откроется вход",
            CLUB_WAITLIST_ACTION,
          ),
        ]),
      },
    );
    return;
  }

  const name = ctx.dbUser.firstName ?? ctx.dbUser.username ?? "участник";

  const text = `Добро пожаловать, ${name}!\n\n${getHelpText(ctx)}`;

  await ctx.reply(text);
}
