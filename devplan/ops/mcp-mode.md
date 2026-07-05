# ops — MCP Streamable HTTP Runbook (P7 / 02 §14 · 10 §6.4)

## 목적

MCP(Model Context Protocol) 클라이언트가 **표준 JSON-RPC**로 서버의 ChatOps 명령을 호출한다. REST 어댑터별 중복 구현 없이 `CommandHandler`에 위임한다.

---

## 1. 활성화

| 환경 | 기본값 | 명시 설정 |
|---|---|---|
| development / test | **ON** | `MCP_ENABLED=false` 로 비활성 |
| production | **OFF** | `MCP_ENABLED=true` 로 opt-in |

```env
MCP_ENABLED=true
```

엔드포인트: `POST /api/v1/mcp` (Streamable HTTP, stateless)

인증: `Authorization: Bearer <API key>` (REST와 동일 scope)

---

## 2. 노출 Tools

| Tool | Command | Scope |
|---|---|---|
| `create_project` | `create_project` | `project:write` |
| `send_prompt` | `send_prompt` | `prompt:send` |
| `get_status` | `status` | `project:read` |
| `approve_run` | `approve` | `approval:resolve` |
| `cancel_run` | `cancel` | `run:cancel` |
| `exec_command` | `exec_command` | `terminal:exec` |

멱등 logical key: `mcp:{x-request-id}:{jsonRpcId}:{toolName}` → CommandHandler `requestId`는 **UUID v5**(01 §5.2)

---

## 3. 클라이언트 예시

```bash
curl -sS -X POST "https://host/api/v1/mcp" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Request-Id: cli-001" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{"name":"create_project","arguments":{"name":"my-app"}},
    "id":1
  }'
```

initialize → tools/list → tools/call 순서. stateless 모드이므로 GET/DELETE `/api/v1/mcp` 는 **405**.

---

## 4. 검증

1. `/health` → `channels.mcp.enabled=true`, `endpoint=/api/v1/mcp`
2. `tools/call` `create_project` → `projectId` 반환
3. scope 부족 API key → tool 응답 `Forbidden` (HTTP 200 + MCP isError)
4. 테스트: `npx vitest run src/mcp src/api/mcp.integration.test.ts src/config.mcp.test.ts`

---

## 5. 운영 주의

- production은 기본 비활성 — 노출 필요 시에만 `MCP_ENABLED=true`
- MCP 요청도 전역 API rate limit(`RATE_LIMIT_MAX`) 적용
- pull 어댑터(Telegram/intranet)와 병행 가능 — 인바운드 경로만 다름

---

## 6. 관련 문서

- `components/02-api-layer.md` §14
- `components/10-channel-adapters.md` §6.4
- `components/16-infra-deployment.md` §12 (MCP_ENABLED)
