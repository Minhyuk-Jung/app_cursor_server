import { describe, expect, it } from "vitest";
import { resolveMcpEnabled } from "./config.js";

describe("resolveMcpEnabled (P7 MCP prod opt-in)", () => {
  it("defaults ON in non-production", () => {
    expect(resolveMcpEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(resolveMcpEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("defaults OFF in production unless MCP_ENABLED=true", () => {
    expect(resolveMcpEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      resolveMcpEnabled({ NODE_ENV: "production", MCP_ENABLED: "true" }),
    ).toBe(true);
  });

  it("honors explicit MCP_ENABLED=false", () => {
    expect(
      resolveMcpEnabled({ NODE_ENV: "development", MCP_ENABLED: "false" }),
    ).toBe(false);
  });
});
