# 구성요소 상세개발계획서 — 01. 공유 계약 (Shared Contracts)

> 위치: `packages/shared` · 레이어: 공통 · 단계: P1
> 상태: 확정 · 최종 수정: 2026-07-04
> 관련 문서: 02(API) · 06(이벤트로그) · 07(상태머신) · 17(Command 처리기) · ADR-005
> 본 문서는 코드를 포함하지 않으며, 정의해야 할 데이터 구조와 규칙을 서술한다.

## 1. 개요 및 책임
모든 구성요소가 공유하는 **정규 타입 정의의 단일 원천**이다. 클라이언트·어댑터·코어가 동일한 데이터 형식으로 소통하도록, 명령(Command)·도메인 이벤트(DomainEvent)·상태값·권한 스코프·공통 DTO·에러 형식을 정의한다. 이 패키지가 존재해야 코어가 요청 출처(웹/메신저)를 알지 못해도 동작하는 헤드리스 구조가 성립한다.

## 2. 범위
- 포함: 정규 명령 형식, 도메인 이벤트 형식, 상태 열거값, 채널/스코프 열거값, 첨부 형식, 이벤트 봉투 형식, 공통 에러 형식, 각 형식에 대한 런타임 검증 규칙.
- 제외: 실제 직렬화/역직렬화 구현(어댑터·API 책임), 저장 스키마(데이터 모델 문서 책임), 비즈니스 처리 로직.

## 3. 의존성
- 상위 의존: 없음(최하위 패키지).
- 하위 소비자: API 레이어, 채널 어댑터, 코어 전 구성요소, 프론트엔드(타입 재사용).

## 4. 내부 구성 요소
| 구성 요소 | 역할 |
|---|---|
| 열거값 정의 모듈 | 채널·상태·스코프 등 고정 문자열 집합 정의 |
| 명령 형식 모듈 | 인바운드 명령 종류별 필드 규격 정의 |
| 이벤트 형식 모듈 | 아웃바운드 도메인 이벤트 종류별 필드 규격 정의 |
| DTO 모듈 | 첨부·이벤트 봉투·에러 등 공용 자료 형식 |
| 검증 규칙 모듈 | 각 형식의 필수/제약 조건을 런타임에서 확인하는 규칙 |

## 5. 데이터 구조 및 필드

### 5.1 열거값
| 열거 이름 | 허용 값 | 의미 |
|---|---|---|
| ChannelSource | web, mobile, slack, teams, telegram, custom, system | 명령/이벤트의 출처 채널 |
| ProjectStatus | active, archived, deleted | 프로젝트 생명주기 상태 |
| SessionStatus | idle, running, waiting_approval, error | 세션 현재 상태 |
| RunStatus | queued, running, streaming, waiting_approval, finished, error, cancelled | 실행(run) 상태 |
| RunTerminalStatus | finished, error, cancelled | 실행 종료 상태(부분집합) |
| Scope | project:read, project:write, prompt:send, run:cancel, approval:resolve, git:write, terminal:exec | 권한 범위 |

### 5.2 명령(NormalizedCommand) — 공통 필드
모든 명령은 공통으로 다음을 가진다.
| 필드 | 자료형 | 필수 | 의미 |
|---|---|---|---|
| kind | 문자열(아래 종류 중 하나) | 필수 | 명령 종류 식별자 |
| source | ChannelSource | 필수 | 명령 출처 채널 |
| requestId | 문자열(UUID) | 필수 | 멱등성·추적용 요청 식별자 |

### 5.3 명령 종류별 추가 필드
| kind | 추가 필드(자료형·필수·의미) |
|---|---|
| create_project | name(문자열·필수·프로젝트명), template(문자열·선택·템플릿 식별자), gitUrl(문자열·선택·가져올 저장소 URL) |
| create_session | projectId(문자열·필수), model(문자열·선택·미지정 시 기본 모델), title(문자열·선택) |
| send_prompt | sessionId(문자열·필수), text(문자열·필수·비어있지 않음), attachments(첨부 배열·선택) |
| cancel | runId(문자열·필수) |
| steer | runId(문자열·필수), text(문자열·필수·추가 지시) |
| approve | approvalId(문자열·필수), decision(approve 또는 reject·필수) |
| status | scope(all/project/session·필수), id(문자열·scope가 project/session이면 필수) |
| exec_command | projectId(문자열·필수), command(문자열·필수·비어있지 않음), cwd(문자열·선택·프로젝트 상대경로) |

### 5.3.1 터미널 exec 스트림 (`packages/shared` exec.ts)
| 종류 | 필드 | 의미 |
|---|---|---|
| ExecStreamMessage | type: stdout/stderr/exit/started/error/ready/pong | 터미널 WebSocket 스트림 |
| ExecClientMessage | type: exec/input/cancel/ping | 클라이언트→서버 |
| ExecErrorCode | queue_full, project_exec_limit, path_escape, docker_unavailable, sandbox_not_ready, sandbox_create_failed, exec_timeout, exec_memory_limit, internal_error | exec 오류 코드 |
| TERMINAL_WS_CLOSE | 4401 unauthorized, 4403 forbidden, 4404 not_found, 4410 project_archived, 1001 server_shutdown | WS close code |

### 5.4 도메인 이벤트(DomainEvent) — 공통 필드
| 필드 | 자료형 | 필수 | 의미 |
|---|---|---|---|
| type | 문자열(아래 종류 중 하나) | 필수 | 이벤트 종류 |
| runId | 문자열 | error 제외 필수 | 관련 실행 식별자 |

### 5.5 이벤트 종류별 추가 필드
| type | 추가 필드(자료형·의미) |
|---|---|
| run_started | sessionId(문자열) |
| assistant | text(문자열·모델 출력 텍스트 조각) |
| tool | name(문자열·툴 이름), input(임의 객체·툴 입력 요약) |
| plan | steps(문자열 배열·작업 계획 항목) |
| file_change | path(문자열·프로젝트 상대경로), changeKind(edit/create/delete) |
| approval_required | approvalId(문자열), detail(문자열·승인 대상 설명) |
| run_done | status(RunTerminalStatus) |
| error | errorKind(startup/run), message(문자열), retryable(참/거짓·선택) |

### 5.6 첨부(Attachment)
| 필드 | 자료형 | 필수 | 의미 |
|---|---|---|---|
| kind | image / file / file_ref | 필수 | 첨부 종류 |
| ref | 문자열 | 필수 | 저장소상의 참조 키 또는 프로젝트 파일 경로 |
| mime | 문자열 | 선택 | MIME 타입 |

### 5.7 이벤트 봉투(EventEnvelope) — RunEventLog 저장/전송 형식
| 필드 | 자료형 | 필수 | 의미 |
|---|---|---|---|
| globalOffset | 정수(서버 전역 1부터) | 필수 | project/global scope 리플레이 커서 |
| runId | 문자열 | 필수 | 실행 식별자 |
| seq | 정수(1부터 증가) | 필수 | run/session scope 리플레이 커서 |
| at | 문자열(ISO8601) | 필수 | 발생 시각 |
| event | DomainEvent | 필수 | 실제 이벤트 |
| projectId | 문자열 | 필수 | scope 조회용 |
| sessionId | 문자열 | 필수 | scope 조회용 |

> 리플레이 커서: session/run 구독은 `seq`, project/global 구독은 `globalOffset`을 사용한다(06, ADR-005).

### 5.8 공통 에러(AppError)
| 필드 | 자료형 | 필수 | 의미 |
|---|---|---|---|
| code | 문자열(에러 코드) | 필수 | 기계 판독용 코드 |
| message | 문자열 | 필수 | 사람 판독용 설명 |
| retryable | 참/거짓 | 필수 | 재시도 가능 여부 |

**exec·sandbox 확장 코드**(AppError.code 또는 ExecStreamMessage.error.code): `docker_unavailable`, `sandbox_not_ready`, `sandbox_create_failed`, `exec_timeout`, `exec_memory_limit`, `path_escape`, `queue_full`, `project_exec_limit`.

## 6. 기능(동작) 명세
이 패키지는 실행 로직이 아니라 형식과 검증 규칙을 제공한다.
1. **형식 정의 제공**: 위 데이터 구조를 타입/상수로 노출한다.
2. **검증 규칙 제공**: 각 명령/이벤트에 대해 (a)필수 필드 존재 (b)열거값 유효성 (c)문자열 비어있음 금지 항목 확인 규칙을 정의한다. 검증은 어댑터·API 경계에서 호출된다.
3. **하위 호환 규칙**: 명령/이벤트 종류는 "추가만" 허용하며, 기존 필드의 의미/자료형 변경은 금지한다. 변경이 필요하면 새 종류를 추가한다.

## 7. 처리 흐름
1. 인바운드: 어댑터가 외부 payload를 받아 검증 규칙으로 확인 후 NormalizedCommand를 만든다.
2. 코어 처리 결과는 DomainEvent로 표현된다.
3. RunEventLog가 DomainEvent를 EventEnvelope로 감싸 저장·발행한다.
4. 각 싱크(WebSocket/웹훅/메신저)는 DomainEvent를 채널 형식으로 변환한다.

## 8. 상호작용
- API/어댑터: 인바운드에서 명령 검증, 아웃바운드에서 이벤트 소비.
- 상태 열거값: 상태머신·데이터 모델·프론트가 동일 값을 공유.
- 스코프 열거값: 인증/인가가 인가 판단의 단일 기준으로 사용.

## 9. 예외/에러 처리
- 검증 실패 시 AppError(code=validation_failed, retryable=false)로 표준화.
- SDK 에러 2종(미시작/실행실패)은 error 이벤트의 errorKind로 구분해 표현한다.
- **P7 mobile 16차:** REST 클라이언트는 `ClientApiError`(packages/shared) + `throwClientApiError`로 web/mobile 공통 처리. `ApiError`는 클라이언트별 alias.

## 9.1 deeplink 규칙 (P7 mobile 16차)
- `parseDeeplink` / `resolveInboxNavigation` — packages/shared 단일 원천.
- 경로: `/project/:id/session/:sid`, `/project/:id/diff`, `/project/:id/terminal`, `/project/:id/git`.

## 9.2 Git API DTO (P7 mobile 18차)
- `ProjectGitStatus` — `GET /projects/:id/git` 응답 타입. web/mobile `@app/shared` 단일 export.
- 필드: `branch`, `dirty`, `changedCount`, `stagedCount`, `unstagedCount`, `lastCommitMessage`, `ahead`, `behind` (upstream 없으면 ahead/behind null).

## 9.3 Markdown GFM helpers (P7 mobile 19~21차)
- `parseTaskListLine` / `isTaskListLine` — `- [ ]` / `- [x]` task list 행 파싱.
- `parseOrderedListLine` — `1. item` ordered list (20차).
- `extractFootnoteDefinitions` / `hasFootnoteDefinition` — GFM footnote (21차).
- `matchStrikethrough` / `STRIKETHROUGH_RE` — `~~text~~` inline 토큰.
- `sanitizeMarkdownLinkHref` — http(s)/mailto만 허용 (20차 web · **22~24차 mobile**).

## 9.5 Maestro device E2E (P7 mobile 23~24차)
- `EXPO_PUBLIC_MAESTRO_E2E=1` 빌드 → `extra.maestroE2e` — CI에서 푸시 등록 skip.
- `maestro-e2e-fixtures` — 시드 프로젝트명·README GFM 마커 (flow assert 공유).
- `maestro-seed-project.ts` — `maestro-e2e` + README.md + **inbox git_status** 시드 (tsx).
- `maestro-seed-lib` — inbox git 중복 prune (29차).
- `footnoteRefTestId` / `clampFootnoteScrollY` — mobile footnote scroll (25차).
- `tryMaestroAutoConnect` — Maestro E2E DEFAULT_SETTINGS 자동 연결 (26차).

## 9.4 Markdown block helpers (P7 mobile 20차)
- `splitMarkdownBlocks` — fenced code 분리.
- `parseMarkdownTable` / `isBlockquoteLine` / `isHorizontalRule` — block-level 파싱.

## 10. 보안 고려사항
- 스코프 열거값을 단일 원천으로 유지해 인가 불일치를 방지한다.
- 첨부는 참조(ref)만 담고 실제 바이트는 별도 저장소에 둔다(형식에 바이너리 미포함).

## 11. 구성/설정값
- 기본 모델 식별자(예: 기본값 상수)를 이 패키지 상수로 노출한다.
- seq 시작값은 1, 증가 단위는 1로 고정한다.

## 12. 테스트 전략
- 각 명령/이벤트에 대해: 필수 필드 누락, 잘못된 열거값, 빈 문자열 케이스가 검증에서 거부되는지 확인.
- 정상 payload가 통과하는지 확인.
- 하위 호환: 종류 추가 시 기존 소비자 코드가 영향받지 않는지(유니온 확장) 확인.

## 13. 개발 순서 / 완료 기준(DoD)
- P1 최우선 착수.
- DoD 체크리스트:
  1. 5장 모든 데이터 구조 정의 완료.
  2. 6장 검증 규칙 정의 완료.
  3. 코어·API·프론트가 이 패키지만 참조하여 빌드 통과.

## 14. 오픈 이슈
- 이벤트 스키마 진화 시 버전 표기 방식(API 버저닝과 정합).
- 런타임 검증 도구 선정(zod/valibot 등).
