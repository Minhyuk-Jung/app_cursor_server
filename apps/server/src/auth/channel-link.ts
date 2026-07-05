import { prisma } from "../db/client.js";

export async function resolveChannelUser(
  channel: string,
  externalUserId: string,
): Promise<string | null> {
  const link = await prisma.channelLink.findUnique({
    where: {
      channel_externalUserId: { channel, externalUserId },
    },
  });
  return link?.userId ?? null;
}

export async function listChannelLinks(userId: string) {
  return prisma.channelLink.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createChannelLink(input: {
  userId: string;
  channel: string;
  externalUserId: string;
}) {
  return prisma.channelLink.upsert({
    where: {
      channel_externalUserId: {
        channel: input.channel,
        externalUserId: input.externalUserId,
      },
    },
    create: input,
    update: { userId: input.userId },
  });
}

export async function deleteChannelLink(
  userId: string,
  linkId: string,
): Promise<boolean> {
  const row = await prisma.channelLink.findUnique({ where: { id: linkId } });
  if (!row || row.userId !== userId) return false;
  await prisma.channelLink.delete({ where: { id: linkId } });
  return true;
}

export async function listTelegramTargets(userId: string): Promise<string[]> {
  const links = await prisma.channelLink.findMany({
    where: { userId, channel: "telegram" },
  });
  return links.map((l) => l.externalUserId);
}

export async function listIntranetTargets(userId: string): Promise<string[]> {
  const links = await prisma.channelLink.findMany({
    where: { userId, channel: "intranet" },
  });
  return links.map((l) => l.externalUserId);
}
