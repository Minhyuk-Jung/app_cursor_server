import { randomBytes } from "node:crypto";
import type { PreviewEntry } from "./types.js";

export class PreviewRegistry {
  private entries = new Map<string, PreviewEntry>();

  issue(input: {
    projectId: string;
    userId: string;
    port: number;
    host?: string;
    ttlMs: number;
  }): PreviewEntry {
    this.purgeExpired();
    const token = randomBytes(24).toString("hex");
    const entry: PreviewEntry = {
      token,
      projectId: input.projectId,
      userId: input.userId,
      host: input.host ?? "127.0.0.1",
      port: input.port,
      expiresAt: Date.now() + input.ttlMs,
    };
    this.entries.set(token, entry);
    return entry;
  }

  get(token: string): PreviewEntry | null {
    this.purgeExpired();
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(token);
      return null;
    }
    return entry;
  }

  revoke(token: string): void {
    this.entries.delete(token);
  }

  /** 프로젝트 아카이브·삭제 시 발급된 preview 토큰 일괄 폐기 */
  revokeForProject(projectId: string): number {
    let revoked = 0;
    for (const [token, entry] of this.entries) {
      if (entry.projectId === projectId) {
        this.entries.delete(token);
        revoked += 1;
      }
    }
    return revoked;
  }

  purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(key);
    }
  }

  size(): number {
    this.purgeExpired();
    return this.entries.size;
  }
}
