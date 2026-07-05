/**
 * P0 스파이크: SDK create→send→events→wait + 인메모리 seq/globalOffset 리플레이 PoC
 */
import { Agent, CursorAgentError } from "@cursor/sdk";
import { InMemoryRunEventLog } from "../src/core/eventlog/in-memory-run-event-log.js";
import {
  runDoneEvent,
  runErrorEvent,
} from "../src/core/sdk/sdk-adapter.js";

async function runSdkRoundTrip(cwd: string): Promise<boolean> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log("[P0] CURSOR_API_KEY 미설정 — SDK 라운드트립 스킵");
    return false;
  }

  console.log("[P0] SDK create→send→events→wait 시작...");
  try {
    const agent = await Agent.create({
      apiKey,
      model: { id: process.env.DEFAULT_MODEL ?? "composer-2.5" },
      local: { cwd },
    });

    const run = await agent.send("Reply with exactly: P0_OK");
    let assistantText = "";
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") assistantText += block.text;
        }
      }
    }
    const result = await run.wait();
    await agent.close();

    console.log(`[P0] SDK wait status=${result.status}`);
    console.log(`[P0] Assistant output (truncated): ${assistantText.slice(0, 120)}`);
    return result.status === "finished";
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error(`[P0] SDK startup failed: ${err.message}`);
    } else {
      console.error("[P0] SDK error:", err);
    }
    return false;
  }
}

async function runEventLogReplayPoC(): Promise<boolean> {
  console.log("[P0] RunEventLog 인메모리 리플레이 PoC...");
  const log = new InMemoryRunEventLog();
  const runId = "run-p0";
  const sessionId = "sess-p0";
  const projectId = "proj-p0";

  const e1 = await log.append({
    runId,
    sessionId,
    projectId,
    event: { type: "run_started", runId, sessionId },
  });
  const e2 = await log.append({
    runId,
    sessionId,
    projectId,
    event: { type: "assistant", runId, text: "hello" },
  });
  const e3 = await log.append({
    runId,
    sessionId,
    projectId,
    event: runDoneEvent(runId, "finished"),
  });

  const sessionReplay = await log.replay("session", sessionId, 0);
  const projectReplay = await log.replay("project", projectId, 0);

  const seqOk =
    sessionReplay.length === 3 &&
    sessionReplay.map((e) => e.seq).join(",") === "1,2,3" &&
    e1.seq === 1 &&
    e2.seq === 2 &&
    e3.seq === 3;

  const globalOk =
    projectReplay.length === 3 &&
    projectReplay.map((e) => e.globalOffset).join(",") === "1,2,3" &&
    e1.globalOffset === 1 &&
    e3.globalOffset === 3;

  const partialReplay = await log.replay("session", sessionId, 1);
  const partialOk =
    partialReplay.length === 2 && partialReplay[0]!.seq === 2;

  const duplicateCheck = await log.replay("session", sessionId, 3);
  const noDuplicate = duplicateCheck.length === 0;

  console.log(`[P0] seq 연속성: ${seqOk ? "OK" : "FAIL"}`);
  console.log(`[P0] globalOffset 연속성: ${globalOk ? "OK" : "FAIL"}`);
  console.log(`[P0] 부분 리플레이(cursor=1): ${partialOk ? "OK" : "FAIL"}`);
  console.log(`[P0] 중복 없음(cursor=3): ${noDuplicate ? "OK" : "FAIL"}`);

  return seqOk && globalOk && partialOk && noDuplicate;
}

async function main() {
  const cwd = process.cwd();
  const replayOk = await runEventLogReplayPoC();
  const sdkOk = await runSdkRoundTrip(cwd);

  if (!replayOk) {
    console.error("[P0] FAIL — 이벤트 로그 PoC 실패");
    process.exit(1);
  }

  if (process.env.CURSOR_API_KEY && !sdkOk) {
    console.error("[P0] FAIL — SDK 라운드트립 실패");
    process.exit(1);
  }

  console.log("[P0] PASS — P0 DoD 충족 (이벤트 로그 PoC" +
    (process.env.CURSOR_API_KEY ? ", SDK 라운드트립" : ", SDK 스킵") +
    ")");
}

main();
