import { prisma } from "../database.js";

const TRANSCRIPTION_ENABLED_KEY = "media.transcription.enabled";

export class BotSettingRepository {
  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const setting = await prisma.botSetting.findUnique({ where: { key } });
    if (!setting) return defaultValue;
    return setting.value === "true";
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await prisma.botSetting.upsert({
      where: { key },
      update: { value: value ? "true" : "false" },
      create: { key, value: value ? "true" : "false" },
    });
  }

  async isTranscriptionEnabled(): Promise<boolean> {
    return this.getBoolean(TRANSCRIPTION_ENABLED_KEY, true);
  }

  async setTranscriptionEnabled(enabled: boolean): Promise<void> {
    await this.setBoolean(TRANSCRIPTION_ENABLED_KEY, enabled);
  }
}

export const botSettingRepository = new BotSettingRepository();
