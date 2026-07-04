import { db } from "../db/database.js";

export interface DownloadTokenRecord {
  token: string;
  peerId: number;
  client: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

function rowToDownloadToken(row: any): DownloadTokenRecord {
  return {
    token: row.token,
    peerId: row.peer_id,
    client: row.client,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at
  };
}

export class DownloadTokenRepository {
  create(data: { token: string; peerId: number; client: string | null; expiresAt: string }): DownloadTokenRecord {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO download_tokens (token, peer_id, client, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(data.token, data.peerId, data.client, data.expiresAt, now);

    return this.findByToken(data.token)!;
  }

  findByToken(token: string): DownloadTokenRecord | null {
    const row = db.prepare("SELECT * FROM download_tokens WHERE token = ?").get(token);
    return row ? rowToDownloadToken(row) : null;
  }

  markUsed(token: string): void {
    db.prepare("UPDATE download_tokens SET used_at = ? WHERE token = ?").run(new Date().toISOString(), token);
  }

  deleteExpired(now = new Date().toISOString()): void {
    db.prepare("DELETE FROM download_tokens WHERE expires_at < ? OR used_at IS NOT NULL").run(now);
  }
}

export const downloadTokenRepository = new DownloadTokenRepository();
