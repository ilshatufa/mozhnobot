import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

mkdirSync(dirname(config.amnezia.dbPath), { recursive: true });

export const db = new DatabaseSync(config.amnezia.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export function migrateDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS peers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT,
      public_key TEXT NOT NULL UNIQUE,
      private_key TEXT,
      preshared_key TEXT,
      assigned_ip TEXT NOT NULL,
      config_text TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      traffic_limit_bytes INTEGER,
      disabled_at TEXT,
      disabled_reason TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS peers_client_active_idx
      ON peers(client)
      WHERE client IS NOT NULL AND deleted_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS peers_assigned_ip_active_idx
      ON peers(assigned_ip)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS peer_traffic (
      peer_id INTEGER PRIMARY KEY,
      total_rx_bytes INTEGER NOT NULL DEFAULT 0,
      total_tx_bytes INTEGER NOT NULL DEFAULT 0,
      last_rx_bytes INTEGER NOT NULL DEFAULT 0,
      last_tx_bytes INTEGER NOT NULL DEFAULT 0,
      last_sampled_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(peer_id) REFERENCES peers(id)
    );

    CREATE TABLE IF NOT EXISTS traffic_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_id INTEGER NOT NULL,
      rx_bytes INTEGER NOT NULL,
      tx_bytes INTEGER NOT NULL,
      sampled_at TEXT NOT NULL,
      FOREIGN KEY(peer_id) REFERENCES peers(id)
    );

    CREATE INDEX IF NOT EXISTS traffic_snapshots_peer_sampled_idx
      ON traffic_snapshots(peer_id, sampled_at);

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      client TEXT,
      peer_id INTEGER,
      reason TEXT,
      payload_json TEXT,
      actor_type TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(peer_id) REFERENCES peers(id)
    );

    CREATE INDEX IF NOT EXISTS action_log_peer_created_idx
      ON action_log(peer_id, created_at);

    CREATE INDEX IF NOT EXISTS action_log_client_created_idx
      ON action_log(client, created_at);

    CREATE TABLE IF NOT EXISTS download_tokens (
      token TEXT PRIMARY KEY,
      peer_id INTEGER NOT NULL,
      client TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(peer_id) REFERENCES peers(id)
    );

    CREATE INDEX IF NOT EXISTS download_tokens_peer_created_idx
      ON download_tokens(peer_id, created_at);

    CREATE INDEX IF NOT EXISTS download_tokens_expires_idx
      ON download_tokens(expires_at);
  `);
}
