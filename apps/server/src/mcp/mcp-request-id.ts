import { v5 as uuidv5 } from "uuid";

/** MCP 멱등 logical key → UUID v5 namespace (01 §5.2 requestId) */
const MCP_IDEMPOTENCY_NS = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

/** MCP tool call 멱등 logical prefix (17/S32 정합) */
export function mcpRequestIdPrefix(
  headerRequestId: string,
  jsonRpcId: string | number | undefined,
): string {
  const rpcPart =
    jsonRpcId !== undefined && jsonRpcId !== null ? String(jsonRpcId) : crypto.randomUUID();
  return `mcp:${headerRequestId}:${rpcPart}`;
}

/** logical key — ops/debug용 */
export function mcpToolRequestIdKey(prefix: string, toolName: string): string {
  return `${prefix}:${toolName}`;
}

/** CommandHandler requestId — deterministic UUID v5 from logical key */
export function mcpToolRequestId(prefix: string, toolName: string): string {
  return uuidv5(mcpToolRequestIdKey(prefix, toolName), MCP_IDEMPOTENCY_NS);
}

export function parseJsonRpcId(body: unknown): string | number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const id = (body as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") return id;
  return undefined;
}
