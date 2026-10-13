import { Prisma } from "@prisma/client";
import { prisma } from "../database.js";

export type ClubSearchCandidate = {
  telegramMessageId: number;
};

export class ClubMessageSearchRepository {
  async search(
    chatTelegramId: bigint,
    terms: readonly string[],
    limit: number,
  ): Promise<ClubSearchCandidate[]> {
    if (terms.length === 0) return [];

    const vector = Prisma.sql`to_tsvector(
      'russian',
      concat_ws(' ', m.text, m.caption, u.username, u.first_name, u.last_name)
    )`;
    const query = Prisma.sql`(${Prisma.join(
      terms.map((term) => Prisma.sql`plainto_tsquery('russian', ${term})`),
      " || ",
    )})`;

    return prisma.$queryRaw<ClubSearchCandidate[]>(Prisma.sql`
      SELECT m.telegram_message_id AS "telegramMessageId"
      FROM club_message_index m
      LEFT JOIN users u ON u.telegram_id = m.author_telegram_id
      WHERE m.chat_telegram_id = ${chatTelegramId}
        AND coalesce(nullif(m.text, ''), nullif(m.caption, '')) IS NOT NULL
        AND ${vector} @@ ${query}
      ORDER BY ts_rank_cd(${vector}, ${query}) DESC, m.posted_at DESC
      LIMIT ${limit}
    `);
  }
}

export const clubMessageSearchRepository = new ClubMessageSearchRepository();
