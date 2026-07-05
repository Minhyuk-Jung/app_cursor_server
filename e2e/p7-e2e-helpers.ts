import { expect } from "@playwright/test";

export const P7_E2E_AUTH = { authorization: "Bearer dev-local-key" };

export async function seedE2eSession(
  request: import("@playwright/test").APIRequestContext,
  apiUrl: string,
  input: { projectId: string; title: string; model?: string },
): Promise<string> {
  const res = await request.post(`${apiUrl}/api/v1/e2e/session/seed`, {
    headers: P7_E2E_AUTH,
    data: {
      projectId: input.projectId,
      title: input.title,
      model: input.model ?? "composer-2.5",
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}
