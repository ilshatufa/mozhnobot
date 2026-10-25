import { Prisma } from "@prisma/client";
import { prisma } from "../database.js";
import type { ClubSearchEvidence } from "../services/club-question-answer.service.js";

export class ClubMessageSearchRepository {
  async search(
    chatTelegramId: bigint,
    queries: readonly string[],
    limit: number,
  ): Promise<ClubSearchEvidence[]> {
    if (queries.length === 0) return [];

    const vector = Prisma.sql`to_tsvector(
      'russian',
      concat_ws(' ', m.text, m.caption, u.username, u.first_name, u.last_name)
    )`;
    const query = Prisma.sql`(${Prisma.join(
      queries.map((phrase) => Prisma.sql`plainto_tsquery('russian', ${phrase})`),
      " || ",
    )})`;

    return prisma.$queryRaw<ClubSearchEvidence[]>(Prisma.sql`
      WITH matches AS (
      SELECT m.telegram_message_id, m.reply_to_telegram_message_id
      FROM club_message_index m
      LEFT JOIN users u ON u.telegram_id = m.author_telegram_id
      WHERE m.chat_telegram_id = ${chatTelegramId}
        AND coalesce(nullif(m.text, ''), nullif(m.caption, '')) IS NOT NULL
        AND ${vector} @@ ${query}
      ORDER BY ts_rank_cd(${vector}, ${query}) DESC, m.posted_at DESC
      LIMIT ${limit}
      ), evidence_ids AS (
        SELECT telegram_message_id FROM matches
        UNION SELECT reply_to_telegram_message_id FROM matches WHERE reply_to_telegram_message_id IS NOT NULL
        UNION SELECT replies.telegram_message_id FROM matches
          CROSS JOIN LATERAL (
            SELECT child.telegram_message_id FROM club_message_index child
            WHERE child.chat_telegram_id = ${chatTelegramId}
              AND child.reply_to_telegram_message_id = matches.telegram_message_id
              AND coalesce(nullif(child.text, ''), nullif(child.caption, '')) IS NOT NULL
            ORDER BY child.posted_at ASC LIMIT 2
          ) replies
      )
      SELECT m.telegram_message_id AS "telegramMessageId",
        concat_ws(' ', u.first_name, u.last_name) AS author,
        m.posted_at AS "postedAt", m.reply_to_telegram_message_id AS "replyToTelegramMessageId",
        concat_ws(' ', m.text, m.caption) AS "fullText",
        CASE WHEN length(concat_ws(' ', m.text, m.caption)) <= 4000
          THEN concat_ws(' ', m.text, m.caption)
          ELSE ts_headline('russian', concat_ws(' ', m.text, m.caption), ${query},
            'StartSel="",StopSel="",MaxFragments=3,MaxWords=100,MinWords=30') END AS text
      FROM club_message_index m
      JOIN evidence_ids e ON e.telegram_message_id = m.telegram_message_id
      LEFT JOIN users u ON u.telegram_id = m.author_telegram_id
      WHERE m.chat_telegram_id = ${chatTelegramId}
        AND coalesce(nullif(m.text, ''), nullif(m.caption, '')) IS NOT NULL
      ORDER BY (m.telegram_message_id IN (SELECT telegram_message_id FROM matches)) DESC,
        ts_rank_cd(${vector}, ${query}) DESC, m.posted_at DESC
      LIMIT ${limit * 2}
    `);
  }
}

export const clubMessageSearchRepository = new ClubMessageSearchRepository();
