import { RunStatus as RunStatusEnum } from "@app/shared";
import { prisma } from "../../db/client.js";
import type { RunEventLog } from "../eventlog/types.js";
import { runDoneEvent, runErrorEvent } from "../sdk/sdk-adapter.js";

const STALE_STATUSES = [
  RunStatusEnum.QUEUED,
  RunStatusEnum.RUNNING,
  RunStatusEnum.STREAMING,
  RunStatusEnum.WAITING_APPROVAL,
];

/** 서버 재시작 시 비종료 실행 안전 마감 (05 §6.6) */
export async function recoverStaleRuns(eventLog: RunEventLog): Promise<number> {
  const staleRuns = await prisma.run.findMany({
    where: { status: { in: STALE_STATUSES } },
    include: { session: true },
  });

  for (const run of staleRuns) {
    await eventLog.append({
      runId: run.id,
      sessionId: run.sessionId,
      projectId: run.session.projectId,
      event: runErrorEvent(
        run.id,
        "서버 재시작으로 실행이 중단되었습니다. 다시 시도해 주세요.",
        true,
      ),
    });
    await eventLog.append({
      runId: run.id,
      sessionId: run.sessionId,
      projectId: run.session.projectId,
      event: runDoneEvent(run.id, "error"),
    });
  }

  return staleRuns.length;
}
