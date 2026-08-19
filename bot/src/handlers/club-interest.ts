import { type AuthContext } from "../middlewares/auth.js";
import { clubInterestRepository } from "../repositories/club-interest.repository.js";

export const CLUB_WAITLIST_ACTION = "club_waitlist_join";

export async function waitlistHandler(ctx: AuthContext): Promise<void> {
  await ctx.answerCbQuery();

  if (ctx.isClubMember) {
    await ctx.editMessageText("Вы уже участник клуба.");
    return;
  }

  await clubInterestRepository.recordWaitlisted(ctx.dbUser.id);
  await ctx.editMessageText(
    "Ура, готово ✅ Ты в листе ожидания, и до клуба остался всего один шаг!\n\nНе отключай уведомления, чтобы не пропустить окошко и увидимся в клубе😉",
  );
}
