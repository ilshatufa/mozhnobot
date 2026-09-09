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
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply");
  if (dryRun === apply) throw new Error("Choose exactly one mode: --dry-run or --apply");

  await prisma.$connect();
  const subscriptionId = positiveIntArgument("--subscription-id");
  const userId = positiveIntArgument("--user-id");
  if (apply && subscriptionId === undefined && userId === undefined && !process.argv.includes("--all")) {
    throw new Error("Apply mode requires --subscription-id, --user-id or explicit --all");
  }

  const filters = { subscriptionId, userId };
  const plans = dryRun
    ? await vpnAccessSyncService.buildPlan(filters)
    : await vpnAccessSyncService.sync(filters);

  let actionCount = 0;
  for (const item of plans) {
    actionCount += item.plan.actions.length;
    logger.info("VPN access sync plan", item);
  }
  const failed = plans.filter((item) => item.provisioning?.success === false).length;
  logger.info(`VPN access sync ${dryRun ? "dry-run" : "apply"} complete`, {
    subscriptions: plans.length,
    actions: actionCount,
    failed,
  });
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    logger.fatal("VPN access sync dry-run failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
