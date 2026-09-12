import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  BOT_TOKEN: "test-token",
  CLUB_GROUP_ID: "1",
  SEED_ADMIN_ID: "1",
  XUI_BASE_URL: "http://localhost:2053",
  XUI_SUB_BASE_URL: "https://example.com",
  XUI_USERNAME: "test",
  XUI_PASSWORD: "test",
  XUI_INBOUND_ID: "1",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  VPN_SETUP_IMAGE_FILE_ID: "test",
  QWEN_API_KEY: "test-key",
});

const { parseQwenTranscriptionResponse } = await import("./transcription-provider.js");

test("parses Qwen ASR text and detected language", () => {
  assert.deepEqual(parseQwenTranscriptionResponse({
    choices: [{
      message: {
        content: "  Проверка расшифровки.  ",
        annotations: [{ type: "audio_info", language: "ru", emotion: "neutral" }],
      },
    }],
  }), {
    text: "Проверка расшифровки.",
    language: "ru",
    segments: [{ type: "audio_info", language: "ru", emotion: "neutral" }],
  });
});

test("rejects an empty Qwen ASR response", () => {
  assert.throws(
    () => parseQwenTranscriptionResponse({ choices: [{ message: { content: " " } }] }),
    /does not contain text/,
  );
});
