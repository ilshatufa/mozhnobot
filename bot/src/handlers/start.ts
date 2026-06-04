import { type AuthContext } from "../middlewares/auth.js";
import { getHelpText } from "./help.js";

export async function startHandler(ctx: AuthContext): Promise<void> {
  const name = ctx.dbUser.firstName ?? ctx.dbUser.username ?? "участник";

  const text = `Добро пожаловать, ${name}!\n\n${getHelpText(ctx)}`;

  await ctx.reply(text);
}
