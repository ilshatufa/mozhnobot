import { z } from "zod";
import type { ClubEventRepository } from "../repositories/club-event.repository.js";

const paymentEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.literal("subscription.activated"),
  clubId: z.string().uuid(),
  clubName: z.string().min(1).max(200),
  subscriptionId: z.string().uuid(),
  telegramUserId: z.number().int().positive().safe(),
  paidAt: z.string().datetime({ offset: true }),
});

export type ClubniPaymentEvent = z.infer<typeof paymentEventSchema>;

export const CLUBNI_PAYMENT_WELCOME_TEXT = [
  "Оплата прошла ✅",
  "⠀",
  "Добро пожаловать в клуб «МОЖНО».",
  "⠀",
  "Теперь можно начинать знакомство с клубом. Следующие шаги придут здесь, в МожноБоте.",
].join("\n");

export function parseClubniPaymentCommand(text: string): ClubniPaymentEvent | null {
  const match = text.match(/^\/clubni_payment\s+([A-Za-z0-9_-]+)$/);
  if (!match) return null;

  try {
    const decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    const parsed = paymentEventSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type DeliveryDependencies = {
  repository: Pick<ClubEventRepository, "createIfNotExists">;
  sendMessage: (telegramUserId: number, text: string) => Promise<unknown>;
};

export async function deliverClubniPaymentWelcome(
  event: ClubniPaymentEvent,
  expectedClubId: string,
  dependencies: DeliveryDependencies,
): Promise<"wrong_club" | "duplicate" | "delivered"> {
  if (event.clubId !== expectedClubId) return "wrong_club";

  const created = await dependencies.repository.createIfNotExists({
    dedupeKey: `clubni_payment:${event.eventId}`,
    eventType: "clubni_payment_succeeded",
    targetUserTelegramId: BigInt(event.telegramUserId),
    occurredAt: new Date(event.paidAt),
    payload: {
      clubId: event.clubId,
      clubName: event.clubName,
      subscriptionId: event.subscriptionId,
      sourceEventId: event.eventId,
    },
  });
  if (!created) return "duplicate";

  await dependencies.sendMessage(event.telegramUserId, CLUBNI_PAYMENT_WELCOME_TEXT);
  return "delivered";
}
