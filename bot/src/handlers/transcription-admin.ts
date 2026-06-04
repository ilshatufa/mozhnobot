import { botSettingRepository } from "../repositories/bot-setting.repository.js";
import { type AuthContext } from "../middlewares/auth.js";

export async function transcriptionOnHandler(ctx: AuthContext): Promise<void> {
  await botSettingRepository.setTranscriptionEnabled(true);
  await ctx.reply("Транскрибация включена.");
}

export async function transcriptionOffHandler(ctx: AuthContext): Promise<void> {
  await botSettingRepository.setTranscriptionEnabled(false);
  await ctx.reply("Транскрибация выключена. Новые медиа будут фиксироваться, но не будут обрабатываться worker-ом.");
}

export async function transcriptionStatusHandler(ctx: AuthContext): Promise<void> {
  const enabled = await botSettingRepository.isTranscriptionEnabled();
  await ctx.reply(`Транскрибация: ${enabled ? "включена" : "выключена"}.`);
}
