import { describe, expect, it, vi } from "vitest";
import { TERMINAL_WS_CLOSE } from "@app/shared";
import { TerminalConnectionRegistry } from "./terminal-connection-registry.js";
import type { WebSocket } from "ws";

function mockSocket(readyState = 1): WebSocket {
  const handlers = new Map<string, () => void>();
  return {
    readyState,
    close: vi.fn(),
    on: vi.fn((event: string, fn: () => void) => {
      handlers.set(event, fn);
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
    }),
    emitClose: () => handlers.get("close")?.(),
  } as unknown as WebSocket & { emitClose: () => void };
}

describe("TerminalConnectionRegistry (13 §6.4)", () => {
  it("closeProject closes open sockets", () => {
    const reg = new TerminalConnectionRegistry();
    const a = mockSocket(1);
    const b = mockSocket(1);
    reg.attach("p1", a);
    reg.attach("p1", b);

    expect(reg.closeProject("p1")).toBe(2);
    expect(a.close).toHaveBeenCalledWith(
      TERMINAL_WS_CLOSE.PROJECT_ARCHIVED,
      "Project archived",
    );
    expect(reg.count("p1")).toBe(0);
  });

  it("closeProject closes connecting sockets", () => {
    const reg = new TerminalConnectionRegistry();
    const socket = mockSocket(0);
    reg.attach("p1", socket);
    expect(reg.closeProject("p1")).toBe(1);
    expect(socket.close).toHaveBeenCalledWith(
      TERMINAL_WS_CLOSE.PROJECT_ARCHIVED,
      "Project archived",
    );
  });

  it("does not close already-closed sockets", () => {
    const reg = new TerminalConnectionRegistry();
    const socket = mockSocket(3);
    reg.attach("p1", socket);
    expect(reg.closeProject("p1")).toBe(0);
  });

  it("closeAll closes every project", () => {
    const reg = new TerminalConnectionRegistry();
    const a = mockSocket(1);
    const b = mockSocket(1);
    reg.attach("p1", a);
    reg.attach("p2", b);
    expect(reg.closeAll(1001, "Server shutting down")).toBe(2);
    expect(a.close).toHaveBeenCalledWith(
      TERMINAL_WS_CLOSE.SERVER_SHUTDOWN,
      "Server shutting down",
    );
    expect(reg.count()).toBe(0);
  });

  it("detach removes socket without closing", () => {
    const reg = new TerminalConnectionRegistry();
    const socket = mockSocket(1);
    reg.attach("p1", socket);
    reg.detach("p1", socket);
    expect(reg.count("p1")).toBe(0);
    expect(socket.close).not.toHaveBeenCalled();
  });
});
