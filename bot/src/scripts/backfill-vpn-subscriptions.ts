import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { vpnSubscriptionBackfillService } from "../services/vpn-subscription-backfill.service.js";

function positiveIntArgument(name: string): number {
  const index = process.argv.indexOf(name);
  const value = Number(index === -1 ? NaN : process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} requires a positive database user id`);
  return value;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply");
  if (dryRun === apply) throw new Error("Choose exactly one mode: --dry-run or --apply");
  const input = {
    routerTechnicalUserId: positiveIntArgument("--router-technical-user-id"),
    routerOwnerUserId: positiveIntArgument("--router-owner-user-id"),
  };

  await prisma.$connect();
  const plan = apply
    ? await vpnSubscriptionBackfillService.apply(input)
    : await vpnSubscriptionBackfillService.plan(input);
  logger.info(`VPN subscription backfill ${dryRun ? "dry-run" : "apply"} complete`, plan);
  if (plan.errors.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    logger.fatal("VPN subscription backfill failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
