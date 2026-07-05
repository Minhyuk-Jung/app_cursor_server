#!/usr/bin/env node
/**
 * P7 mobile 29차 — Maestro device E2E용 데모 프로젝트·README·inbox 시드
 */
import {
  hasInboxGitEntry,
  pickInboxGitDuplicateIds,
} from "../src/lib/maestro-seed-lib.ts";
import { MAESTRO_E2E_INBOX_GIT_TITLE, MAESTRO_E2E_PROJECT_NAME, MAESTRO_E2E_README_MD } from "../src/lib/maestro-e2e-fixtures.ts";

const API = (process.env.MAESTRO_API_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const AUTH = process.env.MAESTRO_API_KEY ?? "dev-local-key";
const PROJECT_NAME = process.env.MAESTRO_PROJECT_NAME ?? MAESTRO_E2E_PROJECT_NAME;
const INBOX_GIT_TITLE = process.env.MAESTRO_INBOX_GIT_TITLE ?? MAESTRO_E2E_INBOX_GIT_TITLE;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${AUTH}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function findProjectId() {
  const { projects } = await api("/api/v1/projects") as { projects: Array<{ id: string; name: string }> };
  const hit = projects.find((p) => p.name === PROJECT_NAME);
  return hit?.id ?? null;
}

async function pruneDuplicateInboxGit() {
  const { items } = await api("/api/v1/inbox") as { items: Array<{ id: string; title: string }> };
  for (const id of pickInboxGitDuplicateIds(items, INBOX_GIT_TITLE)) {
    await api(`/api/v1/inbox/${id}`, { method: "DELETE" });
  }
  const remaining = items.filter((item) => item.title === INBOX_GIT_TITLE);
  if (remaining.length > 1) {
    console.log(`Pruned ${remaining.length - 1} duplicate inbox (${INBOX_GIT_TITLE})`);
  }
  return hasInboxGitEntry(items, INBOX_GIT_TITLE);
}

async function main() {
  const health = await fetch(`${API}/health`);
  if (!health.ok) {
    throw new Error(`API /health failed: ${health.status}`);
  }

  let projectId = await findProjectId();
  if (!projectId) {
    const created = await api("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: PROJECT_NAME }),
    }) as { projectId: string };
    projectId = created.projectId;
    console.log(`Created project ${PROJECT_NAME} (${projectId})`);
  } else {
    console.log(`Reusing project ${PROJECT_NAME} (${projectId})`);
  }

  await api(`/api/v1/projects/${projectId}/file`, {
    method: "PUT",
    body: JSON.stringify({ path: "README.md", content: MAESTRO_E2E_README_MD }),
  });
  console.log("Seeded README.md for markdown preview flow");

  const hasInbox = await pruneDuplicateInboxGit();
  if (!hasInbox) {
    await api("/api/v1/e2e/inbox/seed", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        kind: "git_status",
        deeplink: `/project/${projectId}/git`,
        title: INBOX_GIT_TITLE,
        summary: "Maestro git_status deeplink seed",
      }),
    });
    console.log(`Seeded inbox git_status (${INBOX_GIT_TITLE})`);
  } else {
    console.log(`Reusing inbox git_status (${INBOX_GIT_TITLE})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
