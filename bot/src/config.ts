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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  botToken: parsed.data.BOT_TOKEN,
  clubGroupId: parsed.data.CLUB_GROUP_ID,
  seedAdminId: BigInt(parsed.data.SEED_ADMIN_ID),

  xui: {
    baseUrl: parsed.data.XUI_BASE_URL,
    subBaseUrl: parsed.data.XUI_SUB_BASE_URL,
    username: parsed.data.XUI_USERNAME,
    password: parsed.data.XUI_PASSWORD,
    inboundId: parsed.data.XUI_INBOUND_ID,
  },

  vpnKeyDurationDays: parsed.data.VPN_KEY_DURATION_DAYS,
  vpnTrafficLimitGb: parsed.data.VPN_TRAFFIC_LIMIT_GB,
  vpnSetupImageFileId: parsed.data.VPN_SETUP_IMAGE_FILE_ID,
  vpnSetupImageFileId2: parsed.data.VPN_SETUP_IMAGE_FILE_ID_2,
} as const;
