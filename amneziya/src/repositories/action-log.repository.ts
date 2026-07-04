import { db } from "../db/database.js";

export interface ActionLogRecord {
  id: number;
  action: string;
  client: string | null;
  peerId: number | null;
  reason: string | null;
  payload: unknown;
  actorType: string | null;
  actorId: string | null;
  createdAt: string;
}

function rowToAction(row: any): ActionLogRecord {
  return {
    id: row.id,
    action: row.action,
    client: row.client,
    peerId: row.peer_id,
    reason: row.reason,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    actorType: row.actor_type,
    actorId: row.actor_id,
    createdAt: row.created_at
  };
}

export class ActionLogRepository {
  create(data: {
    action: string;
    client?: string | null;
    peerId?: number | null;
    reason?: string | null;
    payload?: unknown;
    actorType?: string | null;
    actorId?: string | null;
  }): void {
    db.prepare(
      `INSERT INTO action_log (
        action, client, peer_id, reason, payload_json, actor_type, actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.action,
      data.client ?? null,
      data.peerId ?? null,
      data.reason ?? null,
      data.payload === undefined ? null : JSON.stringify(data.payload),
      data.actorType ?? "api",
      data.actorId ?? null,
      new Date().toISOString()
    );
  }

  list(filters: { client?: string; peerId?: number; action?: string; limit?: number }): ActionLogRecord[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (filters.client) {
      where.push("client = ?");
      params.push(filters.client);
    }

    if (filters.peerId) {
      where.push("peer_id = ?");
      params.push(filters.peerId);
    }

    if (filters.action) {
      where.push("action = ?");
      params.push(filters.action);
    }

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    params.push(limit);

    const sql = `
      SELECT * FROM action_log
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?
    `;

    return db.prepare(sql).all(...params).map(rowToAction);
  }
}

export const actionLogRepository = new ActionLogRepository();
