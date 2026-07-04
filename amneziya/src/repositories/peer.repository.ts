import { db } from "../db/database.js";

export interface PeerRecord {
  id: number;
  client: string | null;
  publicKey: string;
  privateKey: string | null;
  presharedKey: string | null;
  assignedIp: string;
  configText: string | null;
  enabled: boolean;
  expiresAt: string | null;
  trafficLimitBytes: number | null;
  disabledAt: string | null;
  disabledReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PeerTrafficRecord {
  peerId: number;
  totalRxBytes: number;
  totalTxBytes: number;
  lastRxBytes: number;
  lastTxBytes: number;
  lastSampledAt: string | null;
  updatedAt: string;
}

function rowToPeer(row: any): PeerRecord {
  return {
    id: row.id,
    client: row.client,
    publicKey: row.public_key,
    privateKey: row.private_key,
    presharedKey: row.preshared_key,
    assignedIp: row.assigned_ip,
    configText: row.config_text,
    enabled: row.enabled === 1,
    expiresAt: row.expires_at,
    trafficLimitBytes: row.traffic_limit_bytes,
    disabledAt: row.disabled_at,
    disabledReason: row.disabled_reason,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTraffic(row: any): PeerTrafficRecord {
  return {
    peerId: row.peer_id,
    totalRxBytes: row.total_rx_bytes,
    totalTxBytes: row.total_tx_bytes,
    lastRxBytes: row.last_rx_bytes,
    lastTxBytes: row.last_tx_bytes,
    lastSampledAt: row.last_sampled_at,
    updatedAt: row.updated_at
  };
}

export class PeerRepository {
  findAll(includeDeleted = false): PeerRecord[] {
    const rows = includeDeleted
      ? db.prepare("SELECT * FROM peers ORDER BY id ASC").all()
      : db.prepare("SELECT * FROM peers WHERE deleted_at IS NULL ORDER BY id ASC").all();
    return rows.map(rowToPeer);
  }

  findByPublicKey(publicKey: string, includeDeleted = false): PeerRecord | null {
    const row = includeDeleted
      ? db.prepare("SELECT * FROM peers WHERE public_key = ?").get(publicKey)
      : db.prepare("SELECT * FROM peers WHERE public_key = ? AND deleted_at IS NULL").get(publicKey);
    return row ? rowToPeer(row) : null;
  }

  findByClient(client: string, includeDeleted = false): PeerRecord | null {
    const row = includeDeleted
      ? db.prepare("SELECT * FROM peers WHERE client = ? ORDER BY id DESC LIMIT 1").get(client)
      : db.prepare("SELECT * FROM peers WHERE client = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(client);
    return row ? rowToPeer(row) : null;
  }

  create(data: {
    client: string | null;
    publicKey: string;
    privateKey: string | null;
    presharedKey: string | null;
    assignedIp: string;
    configText: string | null;
    enabled: boolean;
    expiresAt: string | null;
    trafficLimitBytes: number | null;
  }): PeerRecord {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO peers (
          client, public_key, private_key, preshared_key, assigned_ip, config_text,
          enabled, expires_at, traffic_limit_bytes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.client,
        data.publicKey,
        data.privateKey,
        data.presharedKey,
        data.assignedIp,
        data.configText,
        data.enabled ? 1 : 0,
        data.expiresAt,
        data.trafficLimitBytes,
        now,
        now
      );
    return this.findById(Number(result.lastInsertRowid), true)!;
  }

  findById(id: number, includeDeleted = false): PeerRecord | null {
    const row = includeDeleted
      ? db.prepare("SELECT * FROM peers WHERE id = ?").get(id)
      : db.prepare("SELECT * FROM peers WHERE id = ? AND deleted_at IS NULL").get(id);
    return row ? rowToPeer(row) : null;
  }

  ensureManualPeer(publicKey: string, assignedIp: string): PeerRecord {
    const existing = this.findByPublicKey(publicKey, true);
    if (existing) {
      if (existing.assignedIp !== assignedIp) {
        this.updateRuntimeIdentity(existing.id, assignedIp);
        return this.findById(existing.id, true)!;
      }
      return existing;
    }

    return this.create({
      client: null,
      publicKey,
      privateKey: null,
      presharedKey: null,
      assignedIp,
      configText: null,
      enabled: true,
      expiresAt: null,
      trafficLimitBytes: null
    });
  }

  updateRuntimeIdentity(id: number, assignedIp: string): void {
    db.prepare("UPDATE peers SET assigned_ip = ?, updated_at = ? WHERE id = ?").run(
      assignedIp,
      new Date().toISOString(),
      id
    );
  }

  updateLimits(id: number, data: { expiresAt?: string | null; trafficLimitBytes?: number | null }): PeerRecord {
    const current = this.findById(id, true);
    if (!current) throw new Error(`Peer ${id} not found`);

    const expiresAt = Object.hasOwn(data, "expiresAt") ? data.expiresAt! : current.expiresAt;
    const trafficLimitBytes = Object.hasOwn(data, "trafficLimitBytes")
      ? data.trafficLimitBytes!
      : current.trafficLimitBytes;

    db.prepare("UPDATE peers SET expires_at = ?, traffic_limit_bytes = ?, updated_at = ? WHERE id = ?").run(
      expiresAt,
      trafficLimitBytes,
      new Date().toISOString(),
      id
    );

    return this.findById(id, true)!;
  }

  markDisabled(id: number, reason: string): PeerRecord {
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE peers SET enabled = 0, disabled_at = ?, disabled_reason = ?, updated_at = ? WHERE id = ?"
    ).run(now, reason, now, id);
    return this.findById(id, true)!;
  }

  markEnabled(id: number): PeerRecord {
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE peers SET enabled = 1, disabled_at = NULL, disabled_reason = NULL, updated_at = ? WHERE id = ?"
    ).run(now, id);
    return this.findById(id, true)!;
  }

  markDeleted(id: number): PeerRecord {
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE peers SET enabled = 0, deleted_at = ?, disabled_at = ?, disabled_reason = 'deleted', updated_at = ? WHERE id = ?"
    ).run(now, now, now, id);
    return this.findById(id, true)!;
  }

  upsertTraffic(peerId: number, runtimeRx: number, runtimeTx: number, sampledAt: string): PeerTrafficRecord {
    const current = this.findTraffic(peerId);

    if (!current) {
      db.prepare(
        `INSERT INTO peer_traffic (
          peer_id, total_rx_bytes, total_tx_bytes, last_rx_bytes, last_tx_bytes, last_sampled_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(peerId, runtimeRx, runtimeTx, runtimeRx, runtimeTx, sampledAt, sampledAt);
      return this.findTraffic(peerId)!;
    }

    const deltaRx = runtimeRx >= current.lastRxBytes ? runtimeRx - current.lastRxBytes : runtimeRx;
    const deltaTx = runtimeTx >= current.lastTxBytes ? runtimeTx - current.lastTxBytes : runtimeTx;
    const totalRx = current.totalRxBytes + deltaRx;
    const totalTx = current.totalTxBytes + deltaTx;

    db.prepare(
      `UPDATE peer_traffic
       SET total_rx_bytes = ?, total_tx_bytes = ?, last_rx_bytes = ?, last_tx_bytes = ?,
           last_sampled_at = ?, updated_at = ?
       WHERE peer_id = ?`
    ).run(totalRx, totalTx, runtimeRx, runtimeTx, sampledAt, sampledAt, peerId);

    db.prepare("INSERT INTO traffic_snapshots (peer_id, rx_bytes, tx_bytes, sampled_at) VALUES (?, ?, ?, ?)").run(
      peerId,
      runtimeRx,
      runtimeTx,
      sampledAt
    );

    return this.findTraffic(peerId)!;
  }

  findTraffic(peerId: number): PeerTrafficRecord | null {
    const row = db.prepare("SELECT * FROM peer_traffic WHERE peer_id = ?").get(peerId);
    return row ? rowToTraffic(row) : null;
  }
}

export const peerRepository = new PeerRepository();

