import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../database.js";
import { clubMessageSearchRepository } from "./club-message-search.repository.js";

const databaseUrl = process.env.AI_SEARCH_INTEGRATION_DATABASE_URL;

test("repository finds Russian word forms only inside the configured club", {
  skip: !databaseUrl,
}, async () => {
  const targetChatId = -1004021375237n;
  const otherChatId = -1009999999999n;
  const authorTelegramId = 900000000001n;

  try {
    await prisma.user.create({
      data: {
        telegramId: authorTelegramId,
        username: "integration_author",
        firstName: "Анна",
      },
    });
    await prisma.clubMessageIndex.createMany({
      data: [
        {
          chatTelegramId: targetChatId,
          telegramMessageId: 101,
          authorTelegramId,
          messageType: "text",
          text: "Принимала квартиру после ремонта вместе со специалистом.",
          textLength: 63,
          postedAt: new Date("2026-08-09T12:00:00.000Z"),
        },
        {
          chatTelegramId: otherChatId,
          telegramMessageId: 202,
          authorTelegramId,
          messageType: "text",
          text: "Ремонт в другом чате не должен попадать в выдачу.",
          textLength: 49,
          postedAt: new Date("2026-08-10T12:00:00.000Z"),
        },
      ],
    });

    const results = await clubMessageSearchRepository.search(
      targetChatId,
      ["ремонт", "квартиры"],
      10,
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]?.telegramMessageId, 101);
    assert.equal(results[0]?.authorName, "@integration_author");

    const resultsByAuthor = await clubMessageSearchRepository.search(
      targetChatId,
      ["анна"],
      10,
    );
    assert.equal(resultsByAuthor.length, 1);
    assert.equal(resultsByAuthor[0]?.telegramMessageId, 101);
  } finally {
    await prisma.clubMessageIndex.deleteMany({
      where: { chatTelegramId: { in: [targetChatId, otherChatId] } },
    });
    await prisma.user.deleteMany({ where: { telegramId: authorTelegramId } });
    await prisma.$disconnect();
  }
});
