import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  AMNEZIA_AGENT_TOKEN: z.string().min(12),
  AMNEZIA_AGENT_HOST: z.string().default("0.0.0.0"),
  AMNEZIA_AGENT_PORT: z.coerce.number().int().positive().default(8080),
  AMNEZIA_INTERFACE: z.string().min(1).default("awg0"),
  AMNEZIA_SERVER_HOST: z.string().min(1).default("127.0.0.1"),
  AMNEZIA_SERVER_PORT: z.coerce.number().int().positive().default(51820),
  AMNEZIA_CLIENT_CIDR: z.string().min(1).default("10.9.9.0/24"),
  AMNEZIA_DNS: z.string().min(1).default("1.1.1.1"),
  AMNEZIA_MTU: z.coerce.number().int().nonnegative().default(1280),
  AMNEZIA_PERSISTENT_KEEPALIVE: z.coerce.number().int().nonnegative().default(15),
  AMNEZIA_CONFIG_PATH: z.string().min(1).default("/etc/amnezia/amneziawg/awg0.conf"),
  AMNEZIA_AGENT_DB_PATH: z.string().min(1).default("/var/lib/amnezia-agent/agent.db"),
  AMNEZIA_BACKUP_DIR: z.string().min(1).default("/var/backups/amnezia-agent"),
  AMNEZIA_TRAFFIC_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  AMNEZIA_EXPIRATION_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  AMNEZIA_ACTION_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  AMNEZIA_TRAFFIC_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  AMNEZIA_PUBLIC_BASE_URL: z.string().url().default("https://srv1.amneziya.mozhno.org"),
  AMNEZIA_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  AMNEZIA_DOWNLOAD_FILENAME: z.string().min(1).default("amneziya-se.mozhno.org.conf")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid amneziya-agent environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.AMNEZIA_AGENT_TOKEN === "dev-amneziya-agent-token"
) {
  console.error("AMNEZIA_AGENT_TOKEN must be changed in production");
  process.exit(1);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  token: parsed.data.AMNEZIA_AGENT_TOKEN,
  host: parsed.data.AMNEZIA_AGENT_HOST,
  port: parsed.data.AMNEZIA_AGENT_PORT,
  amnezia: {
    interfaceName: parsed.data.AMNEZIA_INTERFACE,
    serverHost: parsed.data.AMNEZIA_SERVER_HOST,
    serverPort: parsed.data.AMNEZIA_SERVER_PORT,
    clientCidr: parsed.data.AMNEZIA_CLIENT_CIDR,
    dns: parsed.data.AMNEZIA_DNS,
    mtu: parsed.data.AMNEZIA_MTU,
    persistentKeepalive: parsed.data.AMNEZIA_PERSISTENT_KEEPALIVE,
    configPath: parsed.data.AMNEZIA_CONFIG_PATH,
    dbPath: parsed.data.AMNEZIA_AGENT_DB_PATH,
    backupDir: parsed.data.AMNEZIA_BACKUP_DIR,
    trafficPollIntervalMs: parsed.data.AMNEZIA_TRAFFIC_POLL_INTERVAL_MS,
    expirationPollIntervalMs: parsed.data.AMNEZIA_EXPIRATION_POLL_INTERVAL_MS,
    actionLogRetentionDays: parsed.data.AMNEZIA_ACTION_LOG_RETENTION_DAYS,
    trafficSnapshotRetentionDays: parsed.data.AMNEZIA_TRAFFIC_SNAPSHOT_RETENTION_DAYS,
    publicBaseUrl: parsed.data.AMNEZIA_PUBLIC_BASE_URL,
    downloadTtlSeconds: parsed.data.AMNEZIA_DOWNLOAD_TTL_SECONDS,
    downloadFilename: parsed.data.AMNEZIA_DOWNLOAD_FILENAME
  }
} as const;
