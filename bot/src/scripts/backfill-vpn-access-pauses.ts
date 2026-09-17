import { ClubMembershipStatus, VpnSubscriptionAccessOverride } from "@prisma/client";
import { prisma } from "../database.js";

async function main(): Promise<void> {
  const pausedAt = new Date();
  const result = await prisma.vpnSubscription.updateMany({
    where: {
      product: { code: "paid" },
      accessPausedAt: null,
      OR: [
        { accessOverride: VpnSubscriptionAccessOverride.FREE_UNLIMITED },
        { user: { clubStatus: ClubMembershipStatus.MEMBER } },
      ],
    },
    data: { accessPausedAt: pausedAt },
  });
  console.log(JSON.stringify({ pausedSubscriptions: result.count, pausedAt: pausedAt.toISOString() }));
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
