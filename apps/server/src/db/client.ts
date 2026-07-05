import { PrismaClient } from "@prisma/client";

function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

let prismaInstance = createPrismaClient();

/** Vitest integration tests swap DATABASE_URL via useTestDatabase */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const value = Reflect.get(prismaInstance, prop, receiver);
    return typeof value === "function" ? value.bind(prismaInstance) : value;
  },
});

export async function disconnectDb(): Promise<void> {
  await prismaInstance.$disconnect();
}

export async function switchDatabaseUrl(databaseUrl: string): Promise<void> {
  process.env.DATABASE_URL = databaseUrl;
  await prismaInstance.$disconnect();
  prismaInstance = createPrismaClient();
}
