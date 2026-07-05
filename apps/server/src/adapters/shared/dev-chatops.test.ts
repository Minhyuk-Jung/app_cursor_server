import { describe, expect, it } from "vitest";
import { parseDevChatOps } from "./dev-chatops.js";

describe("dev-chatops (10 §5.3)", () => {
  it("parses create_project", () => {
    const cmd = parseDevChatOps("/dev project my-app https://git.example/repo.git");
    expect(cmd?.kind).toBe("create_project");
    if (cmd?.kind === "create_project") {
      expect(cmd.name).toBe("my-app");
      expect(cmd.gitUrl).toBe("https://git.example/repo.git");
    }
  });

  it("parses send_prompt", () => {
    const cmd = parseDevChatOps("/dev prompt sess-1 hello");
    expect(cmd?.kind).toBe("send_prompt");
  });
});
