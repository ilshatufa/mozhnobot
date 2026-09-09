import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { vpnAccessSyncService } from "../services/vpn-access-sync.service.js";

function positiveIntArgument(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} requires a positive integer`);
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--dry-run")) {
    throw new Error(
      "The first implementation stage is plan-only. Use --dry-run; XUI changes stay disabled until the provisioner and backfill are verified.",
    );
  }

  await prisma.$connect();
  const plans = await vpnAccessSyncService.buildPlan({
    subscriptionId: positiveIntArgument("--subscription-id"),
    userId: positiveIntArgument("--user-id"),
  });

  let actionCount = 0;
  for (const item of plans) {
    actionCount += item.plan.actions.length;
    logger.info("VPN access sync plan", item);
  }
  logger.info("VPN access sync dry-run complete", {
    subscriptions: plans.length,
    actions: actionCount,
  });
}

main()
  .catch((err) => {
    logger.fatal("VPN access sync dry-run failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
