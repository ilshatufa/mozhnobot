import { Role } from "@prisma/client";
import { logger } from "../logger.js";
import { type AuthContext } from "../middlewares/auth.js";
import { userRepository } from "../repositories/user.repository.js";
import { vpnService } from "../services/vpn.service.js";

async function resolveTarget(ctx: AuthContext): Promise<bigint | null> {
  const text = (ctx.message && "text" in ctx.message) ? ctx.message.text : "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply("Укажите user_id или @username.");
    return null;
  }

  const arg = args[0];

  if (/^\d+$/.test(arg)) {
    return BigInt(arg);
  }

  const username = arg.replace(/^@/, "");
  const { prisma } = await import("../database.js");
  const found = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });

  if (!found) {
    await ctx.reply(`Пользователь @${username} не найден в базе.`);
    return null;
  }

  return found.telegramId;
}

function formatUser(telegramId: bigint, username?: string | null): string {
  if (username) return `@${username} (${telegramId})`;
  return `${telegramId}`;
}

export async function blockHandler(ctx: AuthContext): Promise<void> {
  const targetId = await resolveTarget(ctx);
  if (!targetId) return;

  const target = await userRepository.findByTelegramId(targetId);
  if (!target) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  if (target.vpnBlocked) {
    await ctx.reply(`VPN-доступ пользователя ${formatUser(target.telegramId, target.username)} уже заблокирован.`);
    return;
  }

  await userRepository.setVpnBlocked(targetId, true);
  await vpnService.disableKeysForUser(target);

  logger.info(`Admin ${ctx.dbUser.telegramId} blocked VPN for ${targetId}`);
  await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} заблокирован (VPN).`);
}

export async function unblockHandler(ctx: AuthContext): Promise<void> {
  const targetId = await resolveTarget(ctx);
  if (!targetId) return;

  const target = await userRepository.findByTelegramId(targetId);
  if (!target) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  if (!target.vpnBlocked) {
    await ctx.reply(`VPN-доступ пользователя ${formatUser(target.telegramId, target.username)} не заблокирован.`);
    return;
  }

  await userRepository.setVpnBlocked(targetId, false);

  logger.info(`Admin ${ctx.dbUser.telegramId} unblocked VPN for ${targetId}`);
  await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} разблокирован (VPN).`);
}

export async function banHandler(ctx: AuthContext): Promise<void> {
  const targetId = await resolveTarget(ctx);
  if (!targetId) return;

  const target = await userRepository.findByTelegramId(targetId);
  if (!target) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  if (target.isBanned) {
    await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} уже забанен.`);
    return;
  }

  await userRepository.setBanned(targetId, true);
  await vpnService.disableKeysForUser(target);

  logger.info(`Admin ${ctx.dbUser.telegramId} banned ${targetId}`);
  await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} забанен.`);
}

export async function unbanHandler(ctx: AuthContext): Promise<void> {
  const targetId = await resolveTarget(ctx);
  if (!targetId) return;

  const target = await userRepository.findByTelegramId(targetId);
  if (!target) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  if (!target.isBanned) {
    await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} не забанен.`);
    return;
  }

  await userRepository.setBanned(targetId, false);

  logger.info(`Admin ${ctx.dbUser.telegramId} unbanned ${targetId}`);
  await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} разбанен.`);
}

export async function promoteHandler(ctx: AuthContext): Promise<void> {
  const targetId = await resolveTarget(ctx);
  if (!targetId) return;

  const target = await userRepository.findByTelegramId(targetId);
  if (!target) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  if (target.role === Role.ADMIN) {
    await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} уже является администратором.`);
    return;
  }

  await userRepository.setRole(targetId, Role.ADMIN);

  logger.info(`Admin ${ctx.dbUser.telegramId} promoted ${targetId} to ADMIN`);
  await ctx.reply(`Пользователь ${formatUser(target.telegramId, target.username)} назначен администратором.`);
}

export async function usersHandler(ctx: AuthContext): Promise<void> {
  const users = await userRepository.findAllWithKeys();

  if (users.length === 0) {
    await ctx.reply("Пользователей нет.");
    return;
  }

  const lines = users.map((u) => {
    const name = u.username ? `@${u.username}` : (u.firstName ?? "—");
    const role = u.role;
    const banned = u.isBanned ? " [ЗАБАНЕН]" : "";
    const vpnBlock = u.vpnBlocked ? " [VPN ЗАБЛОКИРОВАН]" : "";

    let keyStatus = "нет ключа";
    if (u.vpnKeys.length > 0) {
      const key = u.vpnKeys[0];
      if (key.isActive && key.expiresAt > new Date()) {
        keyStatus = `активен до ${key.expiresAt.toLocaleDateString("ru-RU")}`;
      } else {
        keyStatus = "истёк";
      }
    }

    return `${name} (${u.telegramId}) — ${role} — ${keyStatus}${vpnBlock}${banned}`;
  });

  const text = `Пользователи (${users.length}):\n\n${lines.join("\n")}`;

  if (text.length > 4000) {
    for (let i = 0; i < text.length; i += 4000) {
      await ctx.reply(text.slice(i, i + 4000));
    }
  } else {
    await ctx.reply(text);
  }
}

export async function adminPhotoIdHandler(ctx: AuthContext): Promise<void> {
  if (ctx.dbUser.role !== Role.ADMIN) return;
  if (!ctx.message || !("photo" in ctx.message) || ctx.message.photo.length === 0) return;

  const bestPhoto = ctx.message.photo[ctx.message.photo.length - 1];

  await ctx.reply(
    [
      "ID изображения для постов:",
      `<code>${bestPhoto.file_id}</code>`,
      "",
      "file_unique_id:",
      `<code>${bestPhoto.file_unique_id}</code>`,
    ].join("\n"),
    { parse_mode: "HTML" }
  );
}
