import { prisma } from "../database.js";

const TRANSCRIPTION_ENABLED_KEY = "media.transcription.enabled";

export class BotSettingRepository {
  async getString(key: string): Promise<string | null> {
    const setting = await prisma.botSetting.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  async setString(key: string, value: string): Promise<void> {
    await prisma.botSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const value = await this.getString(key);
    if (value === null) return defaultValue;
    return value === "true";
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.setString(key, value ? "true" : "false");
  }

  async isTranscriptionEnabled(): Promise<boolean> {
    return this.getBoolean(TRANSCRIPTION_ENABLED_KEY, true);
  }

  async setTranscriptionEnabled(enabled: boolean): Promise<void> {
    await this.setBoolean(TRANSCRIPTION_ENABLED_KEY, enabled);
  }
}

export const botSettingRepository = new BotSettingRepository();
