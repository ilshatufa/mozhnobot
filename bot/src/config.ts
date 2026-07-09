import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  CLUB_GROUP_ID: z.string().min(1),
  SEED_ADMIN_ID: z.string().min(1),

  XUI_BASE_URL: z.string().url(),
  XUI_SUB_BASE_URL: z.string().url(),
  XUI_USERNAME: z.string().min(1),
  XUI_PASSWORD: z.string().min(1),
  XUI_INBOUND_ID: z.coerce.number().int().positive(),

  DATABASE_URL: z.string().min(1),

  VPN_KEY_DURATION_DAYS: z.coerce.number().int().positive().default(7),
  VPN_TRAFFIC_LIMIT_GB: z.coerce.number().int().positive().default(50),
  VPN_SETUP_IMAGE_FILE_ID: z.string().min(1),
  VPN_SETUP_IMAGE_FILE_ID_2: z.string().optional().default(""),
  VPN_XUI_SERVER_CODE: z.string().min(1).default("xui-main"),
  VPN_XUI_SERVER_NAME: z.string().min(1).default("3X-UI"),
  VPN_XUI_SERVERS_JSON: z.string().optional().default(""),
  VPN_XUI_MULTI_SERVER_CODE: z.string().optional().default(""),
  VPN_XUI_MULTI_SUB_BASE_URL: z.string().url().optional().default(""),
  XRAY_SUBSCRIPTION_HOST: z.string().min(1).default("0.0.0.0"),
  XRAY_SUBSCRIPTION_PORT: z.coerce.number().int().positive().default(18081),
  XRAY_SUBSCRIPTION_TITLE: z.string().min(1).default("МОЖНО ВПН"),
  XRAY_SUBSCRIPTION_SUPPORT_URL: z.string().url().optional().default("https://t.me/MozhnoClub_Bot"),
  XRAY_SUBSCRIPTION_FILE_NAME: z.string().min(1).default("mozhno-vpn.txt"),
  XRAY_SUBSCRIPTION_FILE_NAME_UTF8: z.string().min(1).default("МОЖНО ВПН.txt"),
  XRAY_SUBSCRIPTION_UPDATE_INTERVAL_HOURS: z.coerce.number().int().positive().default(12),
  XRAY_SUBSCRIPTION_JSON_USER_AGENT_PATTERN: z.string().min(1).default("(v2box|incy)"),
  XRAY_SUBSCRIPTION_JSON_RU_DNS: z.string().min(1).default("77.88.8.8"),
  XRAY_SUBSCRIPTION_JSON_REMOTE_DNS: z.string().min(1).default("https://1.1.1.1/dns-query"),
  XRAY_SUBSCRIPTION_JSON_BLOCK_UDP_443: z.coerce.boolean().default(true),
  XRAY_SUBSCRIPTION_JSON_DIRECT_DOMAINS_JSON: z.string().optional().default(""),
  XRAY_SUBSCRIPTION_JSON_PRIVATE_IPS_JSON: z.string().optional().default(""),
  VPN_AMNEZIA_SERVER_CODE: z.string().min(1).default("se"),
  VPN_AMNEZIA_SERVER_NAME: z.string().min(1).default("Amnezia SE / Stockholm"),
  VPN_AMNEZIA_API_BASE_URL: z.string().url().default("https://srv1.amneziya.mozhno.org"),
  VPN_AMNEZIA_API_TOKEN: z.string().min(1).optional().default(""),
  VPN_AMNEZIA_CONFIG_BASE_URL: z.string().url().default("https://amneziya.mozhno.org"),

  MEDIA_PROCESSING_ENABLED: z.coerce.boolean().default(true),
  MEDIA_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  MEDIA_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(50),
  MEDIA_DOWNLOAD_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  MEDIA_CONVERSION_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  MEDIA_IN_PROGRESS_STALE_MS: z.coerce.number().int().positive().default(600000),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  MEDIA_FAILED_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  MEDIA_STORAGE_DIR: z.string().min(1).default("/app/media"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default("gpt-4o-mini-transcribe"),
  OPENAI_TRANSCRIPTION_LANGUAGE: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_PROMPT: z.string().optional().default(""),
  OPENAI_TRANSCRIPTION_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(25),
  OPENAI_TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENAI_TRANSCRIPT_CLEANUP_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_TRANSCRIPT_CLEANUP_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const defaultXrayDirectDomains = [
  "regexp:.*\\.ru$",
  "regexp:.*\\.su$",
  "regexp:.*\\.xn--p1ai$",
  "domain:ozon.app",
  "domain:ozon.ru",
  "domain:ozonusercontent.com",
  "domain:wildberries.ru",
  "domain:wb.ru",
  "domain:yandex.net",
  "domain:yastatic.net",
  "domain:yandex.com",
  "domain:yandex.ru",
  "domain:vk.com",
  "domain:vk-cdn.net",
  "domain:userapi.com",
  "domain:vkuservideo.net",
  "domain:mycdn.me",
  "domain:mradx.net",
  "domain:avito.ru",
  "domain:avito.st",
  "domain:2gis.com",
  "domain:2gis.ru",
  "domain:gismeteo.net",
  "domain:gismeteo.ru",
];

const defaultXrayPrivateIps = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

function parseStringArrayEnv(raw: string, fallback: readonly string[], name: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [...fallback];
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed);
  } catch (err) {
    console.error(`Invalid ${name}: JSON parse failed`, err);
    process.exit(1);
  }

  const result = z.array(z.string().min(1)).safeParse(decoded);
  if (!result.success) {
    console.error(`Invalid ${name}:`, result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

const xuiServerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  apiBaseUrl: z.string().url(),
  subBaseUrl: z.string().url(),
  rawSubBaseUrl: z.string().url().optional(),
  inboundId: z.coerce.number().int().positive(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  apiToken: z.string().min(1).optional(),
  clientFlow: z.string().optional().default("xtls-rprx-vision"),
  clientApiMode: z.enum(["legacy", "clients"]).optional().default("legacy"),
}).superRefine((server, ctx) => {
  if (server.apiToken || (server.username && server.password)) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "XUI server requires either apiToken or username/password",
    path: ["apiToken"],
  });
});

export type XuiServerConfig = z.infer<typeof xuiServerSchema>;

function parseXuiServers(): XuiServerConfig[] {
  const legacyServer = xuiServerSchema.parse({
    code: env.VPN_XUI_SERVER_CODE,
    name: env.VPN_XUI_SERVER_NAME,
    apiBaseUrl: env.XUI_BASE_URL,
    subBaseUrl: env.XUI_SUB_BASE_URL,
    username: env.XUI_USERNAME,
    password: env.XUI_PASSWORD,
    inboundId: env.XUI_INBOUND_ID,
  });

  const raw = env.VPN_XUI_SERVERS_JSON.trim();
  if (!raw) {
    return [legacyServer];
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (err) {
    console.error("Invalid VPN_XUI_SERVERS_JSON: JSON parse failed", err);
    process.exit(1);
  }

  const result = z.array(xuiServerSchema).min(1).safeParse(decoded);
  if (!result.success) {
    console.error("Invalid VPN_XUI_SERVERS_JSON:", result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

const xuiServers = parseXuiServers();
const defaultXuiServer = xuiServers.find((server) => server.code === env.VPN_XUI_SERVER_CODE) ?? xuiServers[0];

export const config = {
  botToken: env.BOT_TOKEN,
  clubGroupId: env.CLUB_GROUP_ID,
  seedAdminId: BigInt(env.SEED_ADMIN_ID),

  xui: {
    baseUrl: defaultXuiServer.apiBaseUrl,
    subBaseUrl: defaultXuiServer.subBaseUrl,
    username: defaultXuiServer.username ?? "",
    password: defaultXuiServer.password ?? "",
    inboundId: defaultXuiServer.inboundId,
  },

  vpnKeyDurationDays: env.VPN_KEY_DURATION_DAYS,
  vpnTrafficLimitGb: env.VPN_TRAFFIC_LIMIT_GB,
  vpnSetupImageFileId: env.VPN_SETUP_IMAGE_FILE_ID,
  vpnSetupImageFileId2: env.VPN_SETUP_IMAGE_FILE_ID_2,
  vpnServers: {
    xui: {
      code: defaultXuiServer.code,
      name: defaultXuiServer.name,
      servers: xuiServers,
      multiServerCode: env.VPN_XUI_MULTI_SERVER_CODE,
      multiSubBaseUrl: env.VPN_XUI_MULTI_SUB_BASE_URL,
    },
    amneziya: {
      code: env.VPN_AMNEZIA_SERVER_CODE,
      name: env.VPN_AMNEZIA_SERVER_NAME,
      apiBaseUrl: env.VPN_AMNEZIA_API_BASE_URL,
      apiToken: env.VPN_AMNEZIA_API_TOKEN,
      configBaseUrl: env.VPN_AMNEZIA_CONFIG_BASE_URL,
    },
  },

  media: {
    processingEnabled: env.MEDIA_PROCESSING_ENABLED,
    workerIntervalMs: env.MEDIA_WORKER_INTERVAL_MS,
    maxFileSizeMb: env.MEDIA_MAX_FILE_SIZE_MB,
    downloadMaxAttempts: env.MEDIA_DOWNLOAD_MAX_ATTEMPTS,
    conversionTimeoutMs: env.MEDIA_CONVERSION_TIMEOUT_MS,
    inProgressStaleMs: env.MEDIA_IN_PROGRESS_STALE_MS,
    retentionDays: env.MEDIA_RETENTION_DAYS,
    failedRetentionDays: env.MEDIA_FAILED_RETENTION_DAYS,
    storageDir: env.MEDIA_STORAGE_DIR,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL,
    openaiTranscriptionLanguage: env.OPENAI_TRANSCRIPTION_LANGUAGE,
    openaiTranscriptionPrompt: env.OPENAI_TRANSCRIPTION_PROMPT,
    openaiTranscriptionMaxFileSizeMb: env.OPENAI_TRANSCRIPTION_MAX_FILE_SIZE_MB,
    openaiTranscriptionTimeoutMs: env.OPENAI_TRANSCRIPTION_TIMEOUT_MS,
    openaiTranscriptCleanupModel: env.OPENAI_TRANSCRIPT_CLEANUP_MODEL,
    openaiTranscriptCleanupTimeoutMs: env.OPENAI_TRANSCRIPT_CLEANUP_TIMEOUT_MS,
  },

  xraySubscription: {
    host: env.XRAY_SUBSCRIPTION_HOST,
    port: env.XRAY_SUBSCRIPTION_PORT,
    title: env.XRAY_SUBSCRIPTION_TITLE,
    supportUrl: env.XRAY_SUBSCRIPTION_SUPPORT_URL,
    fileName: env.XRAY_SUBSCRIPTION_FILE_NAME,
    fileNameUtf8: env.XRAY_SUBSCRIPTION_FILE_NAME_UTF8,
    updateIntervalHours: env.XRAY_SUBSCRIPTION_UPDATE_INTERVAL_HOURS,
    jsonUserAgentPattern: env.XRAY_SUBSCRIPTION_JSON_USER_AGENT_PATTERN,
    jsonRuDns: env.XRAY_SUBSCRIPTION_JSON_RU_DNS,
    jsonRemoteDns: env.XRAY_SUBSCRIPTION_JSON_REMOTE_DNS,
    jsonBlockUdp443: env.XRAY_SUBSCRIPTION_JSON_BLOCK_UDP_443,
    jsonDirectDomains: parseStringArrayEnv(
      env.XRAY_SUBSCRIPTION_JSON_DIRECT_DOMAINS_JSON,
      defaultXrayDirectDomains,
      "XRAY_SUBSCRIPTION_JSON_DIRECT_DOMAINS_JSON"
    ),
    jsonPrivateIps: parseStringArrayEnv(
      env.XRAY_SUBSCRIPTION_JSON_PRIVATE_IPS_JSON,
      defaultXrayPrivateIps,
      "XRAY_SUBSCRIPTION_JSON_PRIVATE_IPS_JSON"
    ),
  },
} as const;
