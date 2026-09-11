import assert from "node:assert/strict";
import test from "node:test";
import { type Message } from "telegraf/types";
import {
  extractSearchQuestion,
  extractSearchQuestionFromMessage,
} from "./club-search.js";

test("extracts questions from separate club and web commands", () => {
  assert.equal(extractSearchQuestion("/ask Кто сталкивался?"), "Кто сталкивался?");
  assert.equal(extractSearchQuestion("/web Что изменилось?", "web"), "Что изменилось?");
  assert.equal(extractSearchQuestion("/web@MozhnoClub_Bot   Где источник?", "web"), "Где источник?");
});

test("uses the replied message when the command has no question", () => {
  const message = {
    text: "/ask@MozhnoClub_Bot",
    reply_to_message: { text: "Как найти такие агрегаторы? Есть ссылки 🙏" },
  } as Message.TextMessage;

  assert.equal(
    extractSearchQuestionFromMessage(message),
    "Как найти такие агрегаторы? Есть ссылки 🙏",
  );
});

test("explicit question takes precedence over the replied message", () => {
  const message = {
    text: "/web Какие агрегаторы работают сейчас?",
    reply_to_message: { text: "Как найти такие агрегаторы?" },
  } as Message.TextMessage;

  assert.equal(
    extractSearchQuestionFromMessage(message, "web"),
    "Какие агрегаторы работают сейчас?",
  );
});

test("uses a replied media caption as the question", () => {
  const message = {
    text: "/ask",
    reply_to_message: { caption: "Кто уже пользовался этим сервисом?" },
  } as Message.TextMessage;

  assert.equal(
    extractSearchQuestionFromMessage(message),
    "Кто уже пользовался этим сервисом?",
  );
});
