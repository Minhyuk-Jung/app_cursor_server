import { prisma } from "../db/client.js";

/** Background agent runs from POST /messages — wait before teardown to avoid unhandled Prisma errors */
export async function waitForSessionSettled(
  sessionId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;
    if (
      session.status === "idle" ||
      session.status === "error" ||
      session.status === "cancelled"
    ) {
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
