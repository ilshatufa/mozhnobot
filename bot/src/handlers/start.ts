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
        "Привет! Спасибо за твой интерес к клубу «МОЖНО», где мы каждый день в теплом кругу:",
        "",
        "• покупаем и сдаем кладовки",
        "• покупаем ОФЗ для стабильного дохода",
        "• за компанию разбарахляемся на Авито на приличные суммы",
        "• шагаем по 10 тыс шагов",
        "• помогаем друг другу в том, что знаем и умеем сами🤗",
        "",
        "- в общем, <b>строим свой капитал</b>, двигаясь маленькими шагами – чтобы спать спокойно и чувствовать себя уверенно)",
        "",
        "Сейчас вход закрыт – <b>жми кнопку</b> ⤵️",
        "И наш бот сообщит тебе, когда откроется окошко в клуб «МОЖНО»!",
        "",
        "В подарок за раннюю регистрацию пришлем нашу клубную методичку «Все фишки Авито»👌",
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback(
            "Хочу в клуб!",
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
