# 개발 표준 / 컨벤션 (Conventions)

> 상태: 확정 · 최종 수정: 2026-07-04 · 관련: `00-overall-devplan.md`, `components/*`, `glossary.md`
> 본 문서는 코드를 포함하지 않는다. 구현 시 **일관성**을 위한 규약이다.

---

## 1. 목적
네이밍·폴더·에러·로깅·Git·문서·LLM 구현 시 준수할 **공통 규칙**을 정의한다.

---

## 2. 저장소·폴더

| 규칙 | 내용 |
|---|---|
| 모노레포 | `apps/server`, `apps/web`, `packages/shared` (00과 동일) |
| 코어 vs 서비스 | `core/` = 도메인 로직, `services/` = 파일/git/터미널, `api/` = 얇은 라우팅 |
| 설정 | 환경별 `.env`는 gitignore, 예시는 `.env.example`만 |
| 워크스페이스 | 프로젝트 파일은 `/workspaces/{projectId}/` 하위만 |

---

## 3. 네이밍

| 대상 | 규칙 | 예(개념) |
|---|---|---|
| 파일·폴더 | kebab-case | `run-event-log`, `session-manager` |
| TypeScript 타입/인터페이스 | PascalCase | `EventEnvelope`, `AuthContext` |
| 함수·변수 | camelCase | `appendEvent`, `globalOffset` |
| DB 테이블 | PascalCase(Prisma) | `RunEvent`, `ChannelLink` |
| API 경로 | kebab-case, `/api/v1` 접두 | `/api/v1/projects/:id/sessions` |
| env 변수 | UPPER_SNAKE | `CURSOR_API_KEY`, `DATABASE_URL` |
| 이벤트 type/kind | snake_case 문자열 | `run_started`, `send_prompt` |

---

## 4. 에러 처리

| 규칙 | 내용 |
|---|---|
| SDK 2종 구분 | 미시작(`startup`) vs 실행 실패(`run`) — 혼동 금지 |
| HTTP 매핑 | AppError.code → 4xx/5xx 일관 매핑(02) |
| retryable | 클라이언트 재시도 가능 시 반드시 표시 |
| 사용자 메시지 | 기술 스택·키 원문 노출 금지 |
| 로그 | runId, agentId, requestId, projectId, sessionId 포함 |

---

## 5. 로깅

| 항목 | 규칙 |
|---|---|
| 형식 | 구조적(JSON 또는 key=value) — NFR-27 |
| 필수 필드 | timestamp, level, message, runId(해당 시), requestId |
| 금지 | API키, 토큰, 비밀값 평문 |
| send 직후 | runId + agentId 즉시 기록(04) |

---

## 6. API·계약

| 규칙 | 내용 |
|---|---|
| 버전 | `/api/v1` 고정, breaking change 시 v2 |
| 명령 | 반드시 NormalizedCommand + requestId |
| 이벤트 | DomainEvent → EventEnvelope로 저장 |
| 페이지네이션 | cursor 또는 offset+limit, 기본 limit 문서화 |

---

## 7. Git·커밋

| 규칙 | 내용 |
|---|---|
| 커밋 메시지 | 한국어 또는 영어 완전 문장, why 중심 |
| 브랜치 | `feature/`, `fix/`, `docs/` 접두 권장 |
| PR | 단계별 수직 슬라이스 단위, 거대 PR 지양 |
| devplan 변경 | CHANGELOG.md 항목 추가 |

---

## 8. 구현 원칙 (프로젝트 규칙)

1. **최소 범위**: 요청과 무관한 코드 삭제·변경 금지.
2. **기존 기능 우선**: 동일 목적 기능이 있으면 재사용, 신규는 문서에 명시.
3. **코어 얇게, API 더 얇게**: 비즈니스 로직은 core/services에만.
4. **dispose/wait 필수**: SDK 사용 규칙(04) 위반 PR 거부.
5. **테스트**: 해당 구성요소 `21-test-strategy` 게이트 미통과 시 merge 보류.
6. **devplan과 코드 불일치**: 코드 변경 시 추적 매트릭스·해당 component 문서 동기화.

---

## 9. LLM/자동 구현 시 지침

| 지침 | 내용 |
|---|---|
| 설계 판단 | devplan·ADR에 없는 아키텍처 변경 금지. 필요 시 ADR 추가 후 구현 |
| 문서 우선 | `components/*` 절차·표를 그대로 따름 |
| 용어 | `glossary.md` 정의 사용 |
| 예시 코드 | devplan 문서에는 예시 코드 금지(본 README 규약) |
| 완료 보고 | DoD 체크리스트 항목별 통과 여부 명시 |

---

## 10. 문서 메타데이터 (devplan)

모든 devplan 문서 상단(또는 하단)에 다음을 포함한다.

| 필드 | 값 예 |
|---|---|
| 상태 | 초안 / 확정 / 폐기 |
| 최종 수정 | YYYY-MM-DD |
| 관련 문서 | 링크 목록 |

---

## 11. 오픈 이슈
- ESLint/Prettier 설정 파일은 구현 착수 시 `apps/server`에 추가하고 본 문서에 링크.
