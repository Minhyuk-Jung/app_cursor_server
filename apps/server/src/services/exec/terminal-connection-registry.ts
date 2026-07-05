import { TERMINAL_WS_CLOSE } from "@app/shared";
import type { WebSocket } from "ws";

const WS_OPEN = 1;
const WS_CONNECTING = 0;

function isClosable(socket: WebSocket): boolean {
  return socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN;
}

/** 13 §6.4 — 프로젝트별 터미널 WebSocket 추적·아카이브/shutdown 시 종료 */
export class TerminalConnectionRegistry {
  private byProject = new Map<string, Set<WebSocket>>();

  attach(projectId: string, socket: WebSocket): void {
    let set = this.byProject.get(projectId);
    if (!set) {
      set = new Set();
      this.byProject.set(projectId, set);
    }
    set.add(socket);
    const onClose = () => {
      set!.delete(socket);
      if (set!.size === 0) {
        this.byProject.delete(projectId);
      }
      socket.off("close", onClose);
    };
    socket.on("close", onClose);
  }

  detach(projectId: string, socket: WebSocket): void {
    const set = this.byProject.get(projectId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) {
      this.byProject.delete(projectId);
    }
  }

  closeProject(
    projectId: string,
    code = TERMINAL_WS_CLOSE.PROJECT_ARCHIVED,
    reason = "Project archived",
  ): number {
    const set = this.byProject.get(projectId);
    if (!set) return 0;
    let closed = 0;
    for (const socket of [...set]) {
      if (isClosable(socket)) {
        socket.close(code, reason);
        closed += 1;
      }
    }
    set.clear();
    this.byProject.delete(projectId);
    return closed;
  }

  /** 13 §6.4 — graceful shutdown 시 모든 터미널 WS 종료 */
  closeAll(
    code = TERMINAL_WS_CLOSE.SERVER_SHUTDOWN,
    reason = "Server shutting down",
  ): number {
    let closed = 0;
    for (const projectId of [...this.byProject.keys()]) {
      closed += this.closeProject(projectId, code, reason);
    }
    return closed;
  }

  count(projectId?: string): number {
    if (projectId) {
      return this.byProject.get(projectId)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.byProject.values()) {
      total += set.size;
    }
    return total;
  }
}
