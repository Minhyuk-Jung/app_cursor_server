/**
 * In-container Agent.create — stdin JSON + CURSOR_API_KEY env → stdout { agentId }
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
const cwd = input.cwd ?? "/workspace";

const agent = await Agent.create({
  apiKey,
  model: { id: input.model },
  local: { cwd, settingSources: [] },
});

process.stdout.write(JSON.stringify({ agentId: agent.agentId }));
await agent.close();
