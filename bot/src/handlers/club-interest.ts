import { Markup } from "telegraf";
import { type AuthContext } from "../middlewares/auth.js";
import { clubInterestRepository } from "../repositories/club-interest.repository.js";

export const CLUB_WAITLIST_ACTION = "club_waitlist_join";
export const CLUB_AVITO_GUIDE_ACTION = "club_avito_guide";

export const AVITO_GUIDE_TEXT = [
  "<b>Авито: стряхиваем пыль с приложения и достаем деньги из шкафов🔥</b>",
  "",
  "ИИ проглотил ВСЕ наши сообщения из раздела клуба «АВИТО: магия расхламления», и собрал всё самое полезное в одном месте👌",
  "",
  "Получилась небольшая, но ёмкая инструкция по применению, ибо Авито - это не просто «продать старый утюг и бигуди бабушки»😁",
  "",
  "Теперь это целая социальная сеть, со своими алгоритмами, и с его помощью МОЖНО:",
  "",
  "◦ освободить дома место и выдохнуть;",
  "◦ заработать на том, что давно лежит без дела;",
  "◦ пополнить копилку, Сейв, ОФЗ или любую другую инвест-цель🔥",
  "◦ перестать смотреть на вещи как на хлам, и начать видеть в них маленькие активы☺️",
  "◦ потренировать насмотренность, ценообразование и продажи",
  "",
  "Итак, методичка «Все фишки Авито»:",
  "",
  "◦ <a href=\"https://teletype.in/@mozhno_club/avito_denezh_trenazher\">Как превратить Авито в денежный тренажер</a>",
  "◦ <a href=\"https://teletype.in/@mozhno_club/avito_item_card\">Как оформить объявление, чтобы его заметили</a>",
  "◦ <a href=\"https://teletype.in/@mozhno_club/avito_item_price\">Как ставить цену и не продешевить</a>",
  "◦ <a href=\"https://teletype.in/@mozhno_club/avito_dostavka\">Доставка, упаковка и частые затыки</a>",
  "◦ <a href=\"https://teletype.in/@mozhno_club/avito_challenge\">Челлендж «1 объявление в день»</a>",
  "",
  "В общем, кто еще не выкладывает объявления - пора))",
  "",
  "Деньги на цели сами себя не заработают 😁",
].join("\n");

export async function waitlistHandler(ctx: AuthContext): Promise<void> {
  await ctx.answerCbQuery();

  if (ctx.isClubMember) {
    await ctx.editMessageText("Вы уже участник клуба.");
    return;
  }

  await clubInterestRepository.recordWaitlisted(ctx.dbUser.id);
  await ctx.editMessageText(
    "Спасибо! Лови методичку нашего клуба «Все фишки Авито» 👋",
    Markup.inlineKeyboard([
      Markup.button.callback("Получить методичку", CLUB_AVITO_GUIDE_ACTION),
    ]),
  );
}

export async function avitoGuideHandler(ctx: AuthContext): Promise<void> {
  await ctx.answerCbQuery();
  await ctx.reply(AVITO_GUIDE_TEXT, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}
