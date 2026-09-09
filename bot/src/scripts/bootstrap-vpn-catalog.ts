import { prisma } from "../database.js";
import { logger } from "../logger.js";
import { vpnCatalogService } from "../services/vpn-catalog.service.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply");
  if (dryRun === apply) throw new Error("Choose exactly one mode: --dry-run or --apply");

  await prisma.$connect();
  const plan = apply ? await vpnCatalogService.apply() : await vpnCatalogService.plan();
  logger.info(`VPN catalog ${dryRun ? "dry-run" : "apply"} complete`, plan);
  if (plan.missingServerCodes.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    logger.fatal("VPN catalog bootstrap failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
