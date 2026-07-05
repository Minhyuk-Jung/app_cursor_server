import { createApp, shutdownApp } from "./app.js";
import { disconnectDb } from "./db/client.js";

async function bootstrap() {
  const ctx = await createApp();

  await ctx.app.listen({ port: ctx.config.port, host: ctx.config.host });
  console.log(`Server listening on ${ctx.config.host}:${ctx.config.port}`);

  const shutdown = async () => {
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
