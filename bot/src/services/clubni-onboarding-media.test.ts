import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClubniTranscriptMessages,
  parseStoredVideo,
  sendSecondVideoWithTranscriptFallback,
  sendVideoWithTranscriptFallback,
} from "./clubni-onboarding-media.service.js";
import { isVideoForbiddenError } from "../telegram-errors.js";

test("formats the onboarding transcript as safe Telegram HTML with the question", () => {
  const messages = buildClubniTranscriptMessages(
    "Первый абзац.\n\nВторой <важный> абзац & детали.",
    "Что тебе сейчас важно?",
  );

  assert.equal(messages.length, 1);
  assert.match(messages[0], /^🎬 <b>Первое видео — текстовая версия<\/b>/);
  assert.match(messages[0], /Второй &lt;важный&gt; абзац &amp; детали\./);
  assert.match(messages[0], /❓ <b>Вопрос<\/b>\nЧто тебе сейчас важно\?/);
  assert.ok(messages[0].length <= 4096);
});

test("keeps a configured onboarding video even before its transcript is ready", () => {
  assert.deepEqual(parseStoredVideo(JSON.stringify({
    fileId: "video-file-id",
    fileUniqueId: "video-unique-id",
    transcript: null,
  })), {
    fileId: "video-file-id",
    fileUniqueId: "video-unique-id",
    transcript: null,
  });
});

test("splits a long onboarding transcript and asks the question only at the end", () => {
  const messages = buildClubniTranscriptMessages("слово ".repeat(1400), "Вопрос?");
  assert.ok(messages.length > 1);
  assert.equal(messages.slice(0, -1).some((message) => message.includes("❓")), false);
  assert.match(messages.at(-1) ?? "", /❓ <b>Вопрос<\/b>/);
  assert.equal(messages.every((message) => message.length <= 4096), true);
});

test("recognizes only Telegram video permission failures", () => {
  assert.equal(isVideoForbiddenError({
    response: { error_code: 400, description: "Bad Request: VOICE_MESSAGES_FORBIDDEN" },
  }), true);
  assert.equal(isVideoForbiddenError({
    response: { error_code: 400, description: "Bad Request: wrong file identifier" },
  }), false);
  assert.equal(isVideoForbiddenError({
    response: { error_code: 403, description: "Forbidden: bot was blocked by the user" },
  }), false);
});

test("sends the transcript and keeps onboarding usable when Telegram forbids video", async () => {
  const sent: Array<{ method: string; text?: string; parseMode?: string }> = [];
  const telegram = {
    async sendVideo() {
      throw {
        response: {
          error_code: 403,
          description: "Forbidden: VOICE_MESSAGES_FORBIDDEN",
        },
      };
    },
    async sendMessage(_chatId: number, text: string, options: { parse_mode?: string }) {
      sent.push({ method: "message", text, parseMode: options.parse_mode });
      return {};
    },
  };

  const result = await sendVideoWithTranscriptFallback(
    telegram as never,
    301474421,
    "video-file-id",
    "Полная расшифровка видео.",
    "Что тебе сейчас важно?",
  );

  assert.equal(result, "transcript");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].parseMode, "HTML");
  assert.match(sent[0].text ?? "", /Полная расшифровка видео\./);
  assert.match(sent[0].text ?? "", /Напиши ответ одним сообщением\./);
});

test("sends the second transcript with the continue button when Telegram forbids video", async () => {
  const sent: Array<{
    text: string;
    replyMarkup?: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
  }> = [];
  const telegram = {
    async sendVideo() {
      throw {
        response: {
          error_code: 403,
          description: "Forbidden: VOICE_MESSAGES_FORBIDDEN",
        },
      };
    },
    async sendMessage(
      _chatId: number,
      text: string,
      options: {
        reply_markup?: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
      },
    ) {
      sent.push({ text, replyMarkup: options.reply_markup });
      return {};
    },
  };

  const result = await sendSecondVideoWithTranscriptFallback(
    telegram as never,
    301474421,
    "video-file-id",
    "🎥 Полная текстовая версия второго видео.",
    "clubni_onboarding_next:subscription-id",
  );

  assert.equal(result, "transcript");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^🎬 <b>Второе видео — текстовая версия<\/b>/);
  assert.match(sent[0].text, /🎥 Полная текстовая версия второго видео\./);
  assert.equal(
    sent[0].replyMarkup?.inline_keyboard[0]?.[0]?.callback_data,
    "clubni_onboarding_next:subscription-id",
  );
});
