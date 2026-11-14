import { z } from "zod";
import type { ClubEventRepository } from "../repositories/club-event.repository.js";

const removalSchema = z.object({
  eventId: z.string().min(1).max(200),
  clubId: z.string().uuid(),
  telegramChatId: z.string().regex(/^-\d+$/),
  telegramUserId: z.number().int().positive().safe(),
  removalStartedAt: z.string().datetime({ offset: true }),
  removedAt: z.string().datetime({ offset: true }),
  reason: z.enum([
    "auto_renew_canceled", "payment_failed", "admin_terminated", "member_left",
    "gift_ended", "other", "administrator_removed",
  ]),
}).refine((event) => Date.parse(event.removalStartedAt) <= Date.parse(event.removedAt));

export type ClubniRemovalEvent = z.infer<typeof removalSchema>;
type Repository = Pick<ClubEventRepository, "createIfNotExists" | "findByDedupeKey" | "findLatestForTargetInChat">;
type Delivery = {
  repository: Repository;
  edit: (messageId: number, text: string) => Promise<unknown>;
};
const CLOCK_TOLERANCE_MS = 5000;

export function parseClubniRemovalCommand(text: string): ClubniRemovalEvent | null {
  const match = text.match(/^\/clubni_removal\s+([A-Za-z0-9_-]+)$/);
  if (!match || text.length > 4096) return null;
  try {
    const parsed = removalSchema.safeParse(JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clubniRemovalReason(reason: ClubniRemovalEvent["reason"]): string {
  const labels: Record<ClubniRemovalEvent["reason"], string> = {
    auto_renew_canceled: "Срок доступа закончился, автопродление отключено.",
    payment_failed: "Оплата продления не прошла, льготный срок закончился.",
    admin_terminated: "Доступ прекращён администратором клуба.",
    member_left: "Участник завершил подписку и вышел из клуба.",
    gift_ended: "Закончился подарочный доступ.",
    other: "Подписка завершена в Clubni.",
    administrator_removed: "Права администратора отозваны, действующей подписки нет.",
  };
  return labels[reason];
}

function matchesRemoval(event: ClubniRemovalEvent, chatId: string, userId: number, at: Date): boolean {
  return event.telegramChatId === chatId && event.telegramUserId === userId &&
    at.getTime() >= Date.parse(event.removalStartedAt) - CLOCK_TOLERANCE_MS &&
    at.getTime() <= Date.parse(event.removedAt) + CLOCK_TOLERANCE_MS;
}

async function applyReason(event: ClubniRemovalEvent, dependencies: Delivery): Promise<void> {
  const notice = await dependencies.repository.findLatestForTargetInChat(
    "clubni_removal_notice", BigInt(event.telegramUserId), BigInt(event.telegramChatId),
    new Date(Date.parse(event.removalStartedAt) - CLOCK_TOLERANCE_MS),
    new Date(Date.parse(event.removedAt) + CLOCK_TOLERANCE_MS),
  );
  if (!notice?.targetMessageTelegramId) return;
  const payload = notice.payload as { text?: unknown; clubId?: unknown } | null;
  if (payload?.clubId !== event.clubId || typeof payload.text !== "string") return;
  const text = `${payload.text}\n\n<b>Причина:</b> ${clubniRemovalReason(event.reason)}`;
  try {
    await dependencies.edit(notice.targetMessageTelegramId, text);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("message is not modified")) throw error;
  }
}

export async function receiveClubniRemoval(
  event: ClubniRemovalEvent,
  expectedClubId: string,
  expectedChatId: string,
  dependencies: Delivery,
): Promise<"wrong_club" | "received"> {
  if (event.clubId !== expectedClubId || event.telegramChatId !== expectedChatId) return "wrong_club";
  await dependencies.repository.createIfNotExists({
    dedupeKey: `clubni_removal:${event.eventId}`,
    eventType: "clubni_removal_reason",
    chatTelegramId: BigInt(event.telegramChatId),
    targetUserTelegramId: BigInt(event.telegramUserId),
    occurredAt: new Date(event.removedAt),
    payload: event,
  });
  await applyReason(event, dependencies);
  return "received";
}

export async function deliverClubniRemovalNotice(
  notice: { clubId: string; chatId: string; userId: number; removedAt: Date; text: string },
  dependencies: Delivery & { send: (text: string) => Promise<{ message_id: number }> },
): Promise<void> {
  const key = `clubni_removal_notice:${notice.chatId}:${notice.userId}:${notice.removedAt.toISOString()}`;
  if (await dependencies.repository.findByDedupeKey(key)) return;

  const savedReason = await dependencies.repository.findLatestForTargetInChat(
    "clubni_removal_reason", BigInt(notice.userId), BigInt(notice.chatId),
    new Date(notice.removedAt.getTime() - CLOCK_TOLERANCE_MS),
    // Telegram requests have a 30-second timeout; allow an in-flight removal to finish.
    new Date(notice.removedAt.getTime() + 60_000),
  );
  const parsed = removalSchema.safeParse(savedReason?.payload);
  const reason = parsed.success && parsed.data.clubId === notice.clubId &&
    matchesRemoval(parsed.data, notice.chatId, notice.userId, notice.removedAt) ? parsed.data : null;
  const message = await dependencies.send(reason
    ? `${notice.text}\n\n<b>Причина:</b> ${clubniRemovalReason(reason.reason)}`
    : notice.text);
  await dependencies.repository.createIfNotExists({
    dedupeKey: key,
    eventType: "clubni_removal_notice",
    chatTelegramId: BigInt(notice.chatId),
    targetUserTelegramId: BigInt(notice.userId),
    targetMessageTelegramId: message.message_id,
    occurredAt: notice.removedAt,
    payload: { text: notice.text, clubId: notice.clubId },
  });
  // The reason may have arrived while sendMessage was in progress.
  const pending = await dependencies.repository.findLatestForTargetInChat(
    "clubni_removal_reason", BigInt(notice.userId), BigInt(notice.chatId),
    new Date(notice.removedAt.getTime() - CLOCK_TOLERANCE_MS),
    new Date(notice.removedAt.getTime() + 60_000),
  );
  const latest = removalSchema.safeParse(pending?.payload);
  if (latest.success && latest.data.clubId === notice.clubId &&
      matchesRemoval(latest.data, notice.chatId, notice.userId, notice.removedAt) &&
      latest.data.eventId !== reason?.eventId) await applyReason(latest.data, dependencies);
}
