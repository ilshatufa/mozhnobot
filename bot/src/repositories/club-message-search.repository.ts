import { Prisma } from "@prisma/client";
import { prisma } from "../database.js";
import { type AiSearchCandidate } from "../services/ai-search-core.js";

type SearchRow = {
  id: number;
  telegramMessageId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  content: string;
  postedAt: Date;
};

export interface ClubMessageSearchRepositoryLike {
  search(chatTelegramId: bigint, terms: readonly string[], limit: number): Promise<AiSearchCandidate[]>;
}

export class ClubMessageSearchRepository implements ClubMessageSearchRepositoryLike {
  async search(
    chatTelegramId: bigint,
    terms: readonly string[],
    limit: number,
  ): Promise<AiSearchCandidate[]> {
    if (terms.length === 0) return [];

    const vector = Prisma.sql`to_tsvector(
      'russian',
      concat_ws(' ', m.text, m.caption, u.username, u.first_name, u.last_name)
    )`;
    const query = Prisma.sql`(${Prisma.join(
      terms.map((term) => Prisma.sql`plainto_tsquery('russian', ${term})`),
      " || ",
    )})`;

    const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT
        m.id AS "id",
        m.telegram_message_id AS "telegramMessageId",
        u.username AS "username",
        u.first_name AS "firstName",
        u.last_name AS "lastName",
        left(coalesce(nullif(m.text, ''), nullif(m.caption, '')), 900) AS "content",
        m.posted_at AS "postedAt"
      FROM club_message_index m
      LEFT JOIN users u ON u.telegram_id = m.author_telegram_id
      WHERE m.chat_telegram_id = ${chatTelegramId}
        AND coalesce(nullif(m.text, ''), nullif(m.caption, '')) IS NOT NULL
        AND ${vector} @@ ${query}
      ORDER BY ts_rank_cd(${vector}, ${query}) DESC, m.posted_at DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => {
      const fullName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
      const authorName = row.username ? `@${row.username}` : (fullName || null);
      return {
        id: row.id,
        telegramMessageId: row.telegramMessageId,
        authorName,
        content: row.content,
        postedAt: row.postedAt,
      };
    });
  }
}

export const clubMessageSearchRepository = new ClubMessageSearchRepository();
