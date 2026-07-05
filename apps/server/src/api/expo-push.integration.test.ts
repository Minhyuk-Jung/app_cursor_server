import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };

describe("Expo push subscribe (P7 mobile 3차)", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    await useTestDatabase("file:./test-expo-push.db");
    ctx = await createApp({ port: 0 });
  });

  beforeEach(async () => {
    await prisma.expoPushToken.deleteMany();
  });

  afterAll(async () => {
    await ctx.app.close();
    await disconnectDb();
  });

  it("registers Expo push token for user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/push/expo-subscribe",
      headers: AUTH,
      payload: { token: "ExponentPushToken[test-device-1]" },
    });
    expect(res.statusCode).toBe(201);

    const rows = await prisma.expoPushToken.findMany({
      where: { userId: "dev-user" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe("ExponentPushToken[test-device-1]");
  });

  it("rejects invalid token format", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/push/expo-subscribe",
      headers: AUTH,
      payload: { token: "not-a-valid-token" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("unsubscribes Expo push token", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/v1/push/expo-subscribe",
      headers: AUTH,
      payload: { token: "ExponentPushToken[rm-me]" },
    });

    const unsub = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/push/expo-unsubscribe",
      headers: AUTH,
      payload: { token: "ExponentPushToken[rm-me]" },
    });
    expect(unsub.statusCode).toBe(200);

    const rows = await prisma.expoPushToken.findMany({
      where: { userId: "dev-user" },
    });
    expect(rows).toHaveLength(0);
  });
});
