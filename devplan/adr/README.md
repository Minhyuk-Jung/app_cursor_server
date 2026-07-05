# Architecture Decision Records (ADR)

> 본 폴더는 **아키텍처 결정의 근거·대안·트레이드오프**를 기록한다. 형식: 상태 · 컨텍스트 · 결정 · 근거 · 대안 · 결과.

| ADR | 제목 | 상태 |
|---|---|---|
| [001](./001-typescript-node.md) | TypeScript + Node LTS 백엔드 | 확정 |
| [002](./002-cursor-sdk-local-runtime.md) | Cursor SDK Local 런타임 | 확정 |
| [003](./003-headless-api-first.md) | 헤드리스 코어 + API 우선 | 확정 |
| [004](./004-run-event-log-keystone.md) | RunEventLog 키스톤 | 확정 |
| [005](./005-dual-replay-cursor.md) | 이중 리플레이 커서(seq + globalOffset) | 확정 |
| [006](./006-single-server-vps.md) | 단일 VPS/온프렘 우선 | 확정 |
| [007](./007-sandbox-sdk-terminal.md) | SDK·터미널 샌드박스 격리 | 확정(단계적) |
| [008](./008-state-from-eventlog.md) | 상태 전이 RunEventLog 단일 원천 | 확정 |

새 결정 시 번호 증가, **폐기 시 문서는 삭제하지 않고 "폐기" 상태로 유지**한다.
