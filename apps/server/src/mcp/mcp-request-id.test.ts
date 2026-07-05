import { describe, expect, it } from "vitest";
import {
  mcpRequestIdPrefix,
  mcpToolRequestId,
  mcpToolRequestIdKey,
  parseJsonRpcId,
} from "./mcp-request-id.js";

describe("mcp-request-id (P7 MCP 2차)", () => {
  it("builds prefix from header and JSON-RPC id", () => {
    expect(mcpRequestIdPrefix("hdr-1", 42)).toBe("mcp:hdr-1:42");
    expect(mcpRequestIdPrefix("hdr-1", "abc")).toBe("mcp:hdr-1:abc");
  });

  it("generates uuid suffix when JSON-RPC id missing", () => {
    const prefix = mcpRequestIdPrefix("hdr-1", undefined);
    expect(prefix.startsWith("mcp:hdr-1:")).toBe(true);
    expect(prefix.length).toBeGreaterThan("mcp:hdr-1:".length);
  });

  it("derives stable UUID v5 from logical tool key", () => {
    const logical = mcpToolRequestIdKey("mcp:hdr:1", "create_project");
    expect(logical).toBe("mcp:hdr:1:create_project");
    const a = mcpToolRequestId("mcp:hdr:1", "create_project");
    const b = mcpToolRequestId("mcp:hdr:1", "create_project");
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("parseJsonRpcId extracts string/number ids only", () => {
    expect(parseJsonRpcId({ id: 7 })).toBe(7);
    expect(parseJsonRpcId({ id: "x" })).toBe("x");
    expect(parseJsonRpcId({ id: null })).toBeUndefined();
    expect(parseJsonRpcId(null)).toBeUndefined();
  });
});
