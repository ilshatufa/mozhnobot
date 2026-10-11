import assert from "node:assert/strict";
import test from "node:test";
import { getMediaInput, type TelegramMessageLike } from "./event-logger.service.js";

function message(overrides: Partial<TelegramMessageLike>): TelegramMessageLike {
  return {
    message_id: 42,
    date: 1_700_000_000,
    chat: { id: 301474421, type: "private" },
    ...overrides,
  };
}

test("keeps the largest private photo file id without creating a transcript input", () => {
  const input = getMediaInput(message({
    photo: [
      { file_id: "small", file_unique_id: "small-u" },
      { file_id: "large", file_unique_id: "large-u", file_size: 12345 },
    ],
  }), 7, true);

  assert.deepEqual(input, {
    messageIndexId: 7,
    chatTelegramId: 301474421n,
    telegramMessageId: 42,
    mediaType: "photo",
    telegramFileId: "large",
    telegramFileUniqueId: "large-u",
    fileSize: 12345,
  });
  assert.equal(getMediaInput(message({ photo: [{ file_id: "large" }] }), 7), null);
});

test("keeps private document metadata and file id", () => {
  const input = getMediaInput(message({
    document: {
      file_id: "document-file",
      file_unique_id: "document-unique",
      file_size: 54321,
      mime_type: "application/pdf",
      file_name: "guide.pdf",
    },
  }), 8, true);

  assert.equal(input?.mediaType, "document");
  assert.equal(input?.telegramFileId, "document-file");
  assert.equal(input?.telegramFileUniqueId, "document-unique");
  assert.equal(input?.mimeType, "application/pdf");
  assert.equal(input?.title, "guide.pdf");
});

test("keeps transcribable private video metadata with the existing path", () => {
  const input = getMediaInput(message({
    video: {
      file_id: "video-file",
      file_unique_id: "video-unique",
      duration: 75,
      file_size: 999,
      mime_type: "video/mp4",
    },
  }), 9, true);

  assert.equal(input?.mediaType, "video");
  assert.equal(input?.telegramFileId, "video-file");
  assert.equal(input?.durationSeconds, 75);
});
