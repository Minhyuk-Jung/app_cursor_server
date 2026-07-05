import { RunStatus as RunStatusEnum } from "@app/shared";
import { prisma } from "../db/client.js";
import type { Scheduler } from "../core/scheduler/scheduler.js";
import { purgeOrphanAttachments } from "../services/file/file-service.js";

const ACTIVE_RUN_STATUSES = [
  RunStatusEnum.QUEUED,
  RunStatusEnum.RUNNING,
  RunStatusEnum.STREAMING,
  RunStatusEnum.WAITING_APPROVAL,
];

/** NFR-32: 오래된 RunEvent 삭제 */
export async function purgeOldRunEvents(retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const result = await prisma.runEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/** 08 §9: 스케줄러 running vs DB active run 정합 */
export async function reconcileSchedulerSlots(
  scheduler: Scheduler,
): Promise<number> {
  const activeRuns = await prisma.run.findMany({
    where: { status: { in: ACTIVE_RUN_STATUSES } },
    select: { id: true },
  });
  const expected = new Set(activeRuns.map((r) => r.id));
  return scheduler.reconcileOrphans(expected);
}

function collectReferencedAttachmentRefs(
  attachmentsJson: string | null | undefined,
  refs: Set<string>,
): void {
  if (!attachmentsJson) return;
  try {
    const parsed = JSON.parse(attachmentsJson) as Array<{ ref?: string }>;
    if (!Array.isArray(parsed)) return;
    for (const att of parsed) {
      if (att.ref) refs.add(att.ref);
    }
  } catch {
    // ignore malformed JSON
  }
}

/** P7 — DB에 없는 첨부 blob 정리 (24h 기본) */
export async function purgeOrphanAttachmentsAllProjects(
  minAgeMs = 86_400_000,
): Promise<number> {
  const projects = await prisma.project.findMany({
    select: { id: true, rootPath: true },
  });
  let total = 0;
  for (const project of projects) {
    const messages = await prisma.message.findMany({
      where: { session: { projectId: project.id } },
      select: { attachmentsJson: true },
    });
    const refs = new Set<string>();
    for (const row of messages) {
      collectReferencedAttachmentRefs(row.attachmentsJson, refs);
    }
    total += await purgeOrphanAttachments(project.rootPath, refs, minAgeMs);
  }
  return total;
}

export function startMaintenanceJobs(
  scheduler: Scheduler,
  retentionDays: number,
  intervalMs = 60 * 60 * 1000,
  attachmentMinAgeMs = 86_400_000,
): ReturnType<typeof setInterval> {
  const tick = () => {
    void purgeOldRunEvents(retentionDays).catch(() => undefined);
    void reconcileSchedulerSlots(scheduler).catch(() => undefined);
    void purgeOrphanAttachmentsAllProjects(attachmentMinAgeMs).catch(
      () => undefined,
    );
  };
  tick();
  return setInterval(tick, intervalMs);
}
