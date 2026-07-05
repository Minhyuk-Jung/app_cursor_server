/**
 * In-container Agent.resume → send → stream → wait
 * CURSOR_API_KEY via env; stdin { agentId, prompt } — prompt: string | SDKUserMessage
 * NDJSON: { kind:'run' } | { kind:'stream', event } | { kind:'done', status }
 * SIGTERM → run.cancel() when supported (04 §6.6)
 */
import { readFileSync } from "node:fs";
import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error("CURSOR_API_KEY is required");
  process.exit(1);
}

const raw = readFileSync(0, "utf8");
const input = JSON.parse(raw);

const agent = await Agent.resume(input.agentId, { apiKey });
const run = await agent.send(input.prompt);

/** @type {Awaited<ReturnType<typeof agent.send>> | null} */
let activeRun = run;

process.on("SIGTERM", () => {
  void (async () => {
    try {
      if (activeRun?.supports?.("cancel")) {
        await activeRun.cancel();
      }
    } finally {
      process.exit(143);
    }
  })();
});

process.stdout.write(`${JSON.stringify({ kind: "run", runId: run.id })}\n`);

for await (const event of run.stream()) {
  process.stdout.write(
    `${JSON.stringify({ kind: "stream", event })}\n`,
  );
}

const result = await run.wait();
activeRun = null;
process.stdout.write(
  `${JSON.stringify({ kind: "done", status: result.status })}\n`,
);
await agent.close();
