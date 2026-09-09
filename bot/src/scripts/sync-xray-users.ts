import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { vpnService } from "../services/vpn.service.js";

function requestedUserId(): number | null {
  const index = process.argv.indexOf("--user-id");
  if (index === -1) return null;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error("--user-id requires a positive database user id");
  return value;
}

async function main(): Promise<void> {
  const userId = requestedUserId();
  if (userId === null && !process.argv.includes("--all")) {
    throw new Error("Use --user-id <database-id> for a canary or --all for every active VPN user");
  }

  await prisma.$connect();
  const activeRows = await prisma.vpnKey.findMany({
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(userId === null ? {} : { userId }),
      user: { vpnBlocked: false, isBanned: false },
    },
    select: { userId: true },
    distinct: ["userId"],
    orderBy: { userId: "asc" },
  });

  let completed = 0;
  for (const row of activeRows) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
    await vpnService.getOrCreateKey(user);
    completed += 1;
    logger.info("Xray user synchronized", { userId: user.id, completed, total: activeRows.length });
  }

  logger.info("Xray synchronization complete", { completed, requested: activeRows.length });
}

main()
  .catch((err) => {
    logger.fatal("Xray synchronization failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
