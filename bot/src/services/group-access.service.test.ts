import assert from "node:assert/strict";
import test from "node:test";
import {
  GroupAccessService,
  type ChatMemberUpdateLike,
  type GroupAccessRepository,
  type GroupAccessTelegram,
  type GroupAccessUser,
} from "./group-access.service.js";

const SOURCE_CHAT_ID = "-1003393970920";
const BERLIN_CHAT_ID = "-1003774482834";
const USER_ID = 123456789;

function member(status: string, isMember?: boolean) {
  return {
    status,
    is_member: isMember,
    user: { id: USER_ID, username: "member" },
  };
}

function update(chatId: string, oldStatus: string, newStatus: string): ChatMemberUpdateLike {
  return {
    chat: { id: Number(chatId) },
    date: 1_789_164_000,
    old_chat_member: member(oldStatus),
    new_chat_member: member(newStatus),
  };
}

class FakeRepository implements GroupAccessRepository {
  user: GroupAccessUser = {
    telegramId: BigInt(USER_ID),
    username: "member",
    groupRemovalExempt: false,
    clearAccessGroupAt: null,
  };

  scheduleCalls: Date[] = [];
  clearCalls = 0;
  dueUsers: GroupAccessUser[] = [];

  async findByTelegramId(): Promise<GroupAccessUser> {
    return this.user;
  }

  async upsertFromTelegramUser(): Promise<GroupAccessUser> {
    return this.user;
  }

  async scheduleGroupAccessClearance(_telegramId: bigint, clearAt: Date): Promise<boolean> {
    if (this.user.groupRemovalExempt || this.user.clearAccessGroupAt) return false;
    this.scheduleCalls.push(clearAt);
    this.user = { ...this.user, clearAccessGroupAt: clearAt };
    return true;
  }

  async clearGroupAccessClearance(): Promise<void> {
    this.clearCalls += 1;
    this.user = { ...this.user, clearAccessGroupAt: null };
  }

  async findDueGroupAccessClearances(): Promise<GroupAccessUser[]> {
    return this.dueUsers;
  }
}

function settings() {
  return {
    enabled: true,
    sourceChatId: SOURCE_CHAT_ID,
    managedChatIds: [BERLIN_CHAT_ID],
    graceHours: 24,
    dueIntervalMs: 300_000,
  };
}

function telegram(sourceStatus: string, removalFails = false) {
  const removed: Array<{
    chatId: string | number;
    userId: number;
    onlyIfBanned: boolean | undefined;
  }> = [];
  const api: GroupAccessTelegram = {
    async getChatMember() {
      return { status: sourceStatus };
    },
    async unbanChatMember(chatId, userId, extra) {
      if (removalFails) throw new Error("Telegram API unavailable");
      removed.push({ chatId, userId, onlyIfBanned: extra?.only_if_banned });
      return true;
    },
  };
  return { api, removed };
}

test("club departure schedules clearance exactly 24 hours after the event", async () => {
  const repository = new FakeRepository();
  const service = new GroupAccessService(repository, settings());
  const { api } = telegram("left");

  await service.handleChatMember(update(SOURCE_CHAT_ID, "member", "left"), api);

  assert.equal(repository.scheduleCalls.length, 1);
  assert.equal(
    repository.scheduleCalls[0].getTime(),
    1_789_164_000_000 + 24 * 60 * 60 * 1000,
  );
});

test("club rejoin cancels a pending clearance", async () => {
  const repository = new FakeRepository();
  repository.user = { ...repository.user, clearAccessGroupAt: new Date() };
  const service = new GroupAccessService(repository, settings());
  const { api } = telegram("member");

  await service.handleChatMember(update(SOURCE_CHAT_ID, "left", "member"), api);

  assert.equal(repository.clearCalls, 1);
  assert.equal(repository.user.clearAccessGroupAt, null);
});

test("exempt entrant is kept without checking club membership", async () => {
  const repository = new FakeRepository();
  repository.user = { ...repository.user, groupRemovalExempt: true };
  const service = new GroupAccessService(repository, settings());
  let membershipChecks = 0;
  const api: GroupAccessTelegram = {
    async getChatMember() {
      membershipChecks += 1;
      return { status: "left" };
    },
    async unbanChatMember() {
      throw new Error("must not remove exempt user");
    },
  };

  await service.handleChatMember(update(BERLIN_CHAT_ID, "left", "member"), api);

  assert.equal(membershipChecks, 0);
});

test("non-club entrant is removed from Berlin with rejoin still allowed", async () => {
  const repository = new FakeRepository();
  const service = new GroupAccessService(repository, settings());
  const { api, removed } = telegram("left");

  await service.handleChatMember(update(BERLIN_CHAT_ID, "left", "member"), api);

  assert.deepEqual(removed, [
    { chatId: BERLIN_CHAT_ID, userId: USER_ID, onlyIfBanned: false },
  ]);
});

test("failed immediate removal is queued for retry", async () => {
  const repository = new FakeRepository();
  const service = new GroupAccessService(repository, settings());
  const { api } = telegram("left", true);

  await service.handleChatMember(update(BERLIN_CHAT_ID, "left", "member"), api);

  assert.equal(repository.scheduleCalls.length, 1);
});

test("due clearance is cancelled when the user returned to the club", async () => {
  const repository = new FakeRepository();
  repository.dueUsers = [repository.user];
  const service = new GroupAccessService(repository, settings());
  const { api, removed } = telegram("member");

  await service.processDue(api);

  assert.equal(repository.clearCalls, 1);
  assert.equal(removed.length, 0);
});

test("Telegram failure keeps due clearance for the next retry", async () => {
  const repository = new FakeRepository();
  const dueAt = new Date(1_789_164_000_000);
  repository.user = { ...repository.user, clearAccessGroupAt: dueAt };
  repository.dueUsers = [repository.user];
  const service = new GroupAccessService(repository, settings());
  const { api } = telegram("left", true);

  await service.processDue(api);

  assert.equal(repository.clearCalls, 0);
  assert.equal(repository.user.clearAccessGroupAt, dueAt);
});
