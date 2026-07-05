# 용어집 (Glossary)

> 상태: 확정 · 최종 수정: 2026-07-04 · 관련: `00-overall-devplan.md`, `components/*`

본 문서는 devplan 전체에서 사용하는 **핵심 용어의 단일 정의**이다. 구현·리뷰·문서 작성 시 동일한 의미로 사용한다.

---

## A

| 용어 | 정의 |
|---|---|
| **Agent (에이전트)** | Cursor SDK가 생성·관리하는 AI 실행 주체. `agentId`로 식별하며, 세션과 1:1 매핑된다. |
| **AgentHandle** | SdkAdapter가 감싼 살아있는 에이전트 인스턴스 참조. dispose로 자원 회수한다. |
| **ApprovalRequest (승인 요청)** | 실행 중 AI 툴이 위험 작업을 수행하기 전 사용자 승인을 요청하는 기록. **변경 리뷰 승인과 다르다.** |
| **Attachment (첨부)** | 프롬프트에 함께 보내는 이미지·파일·파일 참조. `ref`로 blob 또는 프로젝트 경로를 가리킨다. |
| **AuthContext (인증 컨텍스트)** | 요청 주체(사용자/머신)의 식별자·스코프·채널 출처를 담은 인증 결과. |

## C

| 용어 | 정의 |
|---|---|
| **ChannelSource** | 명령·이벤트의 출처 채널(web, mobile, slack, teams, telegram, custom, system). |
| **ChannelAdapter (채널 어댑터)** | 외부 프로토콜(메신저 등)과 정규 Command/DomainEvent를 번역하는 어댑터. |
| **Command (명령)** | 인바운드 정규 명령(NormalizedCommand). kind·source·requestId를 포함한다. |
| **Command 처리기** | 모든 명령의 단일 진입점. 멱등성·인가·사용량 게이트·라우팅을 담당한다. |

## D

| 용어 | 정의 |
|---|---|
| **DomainEvent (도메인 이벤트)** | 코어에서 발생하는 아웃바운드 표준 이벤트. WebSocket·웹훅·메신저가 동일 형식을 소비한다. |
| **deeplink (딥링크)** | 알림·인박스 항목에서 관련 화면(세션/diff 등)으로 이동하는 경로. |
| **dispose (해제)** | SdkAdapter/SessionManager가 SDK 자원(프로세스·핸들)을 회수하는 동작. 누수 방지 필수. |

## E

| 용어 | 정의 |
|---|---|
| **EventEnvelope (이벤트 봉투)** | RunEventLog에 저장·전송되는 단위. globalOffset, runId, seq, at, event, projectId, sessionId를 포함한다. |
| **실행 중 승인** | run 상태 `waiting_approval`. AI 툴 실행(위험 명령 등)에 대한 승인. 07·09에서 다룬다. |
| **변경 리뷰 승인** | AI가 만든 파일 변경을 diff로 보고 커밋 전 파일별 승인/거절. 12·15에서 다룬다. |

## G

| 용어 | 정의 |
|---|---|
| **globalOffset** | 서버 전역 단조 증가 이벤트 커서. project/global scope 리플레이 기준. run과 무관하게 1부터 증가한다. |
| **Global 인박스** | 모든 프로젝트의 완료·승인·에러 알림을 한 화면에 모은 뷰. |

## H

| 용어 | 정의 |
|---|---|
| **헤드리스 코어** | UI 없이 비즈니스 로직만 담당하는 서버 내부. 웹·메신저는 모두 API 클라이언트이다. |

## L

| 용어 | 정의 |
|---|---|
| **Local 런타임** | Cursor SDK가 서버의 `cwd`(프로젝트 디렉터리)에서 에이전트를 실행하는 모드. Cloud 런타임과 대비된다. |
| **LRU 캐시** | SessionManager가 에이전트 인스턴스를 최근 사용 기준으로 보관·회수하는 방식. |

## M

| 용어 | 정의 |
|---|---|
| **멱등성 (Idempotency)** | 동일 `requestId` 재요청 시 중복 실행 없이 기존 결과를 재응답하는 성질. Command 처리기가 보장한다. |

## N

| 용어 | 정의 |
|---|---|
| **NormalizedCommand** | 어떤 채널에서 와도 동일한 형식으로 수렴된 정규 명령. 01에서 정의한다. |
| **Notification (알림)** | 인박스에 적재되는 알림 항목. kind·priority·deeplink를 포함한다. |

## P

| 용어 | 정의 |
|---|---|
| **Project (프로젝트)** | 워크스페이스 내 하나의 개발 단위. rootPath·status·세션·파일 트리를 가진다. |
| **PWA** | Progressive Web App. 웹을 홈 화면 설치·오프라인 캐시·푸시 알림 가능하게 하는 형태. |
| **Port & Adapter** | 외부 프로토콜을 어댑터로 격리하고 코어는 정규 타입만 사용하는 아키텍처 패턴. |

## R

| 용어 | 정의 |
|---|---|
| **Run (실행)** | `send_prompt` 한 번에 대응하는 AI 작업 단위. runId로 식별. queued→running→…→finished/error/cancelled. |
| **RunEventLog** | 모든 실행 이벤트를 저장 후 발행하는 이벤트 버스·로그. 리플레이·인박스·상태 전이의 키스톤. |
| **RunTerminalStatus** | 실행 종료 상태: finished, error, cancelled. |
| **requestId** | 명령마다 부여하는 고유 요청 식별자. 멱등성·추적용. |
| **리플레이 (Replay)** | 연결 재개 시 누락된 이벤트를 커서(seq 또는 globalOffset) 이후부터 다시 전송하는 동작. |

## S

| 용어 | 정의 |
|---|---|
| **Sandbox (샌드박스)** | 프로젝트별 격리 컨테이너. 터미널·프리뷰·(목표) SDK 에이전트 실행 환경. |
| **Scheduler (스케줄러)** | 동시 실행 상한·큐잉·슬롯 승인/해제를 담당. VPS 자원 보호. |
| **Scope (스코프)** | 권한 범위(project:read, prompt:send 등). 인가 판단의 기준. |
| **Scope (구독)** | WebSocket 구독 범위: session, project, global. 리플레이 커서 종류가 달라진다. |
| **seq** | 실행(run) 내 단조 증가 순번(1부터). session/run scope 리플레이 기준. |
| **Session (세션)** | 프로젝트 내 하나의 대화·작업 갈래. agentId·model·branch·summary를 가진다. |
| **SessionManager** | 세션·에이전트 생명주기·실행 개시·이벤트 중계를 담당. |
| **Sink (싱크)** | DomainEvent를 소비하는 구독자(WebSocket, 웹훅, 메신저 어댑터). |
| **Snapshot (스냅샷/체크포인트)** | 실행 전 자동 git 커밋/태그로 만든 되돌리기 지점. |
| **Source (출처)** | 명령·세션이 생성된 채널(web, slack 등). 멀티 클라이언트 추적용. |
| **steer (추가 지시)** | 진행 중 run에 방향 수정 지시를 보내는 동작. |
| **Subscription (구독)** | 아웃바운드 이벤트를 특정 채널·대상으로 받겠다는 등록. |

## W

| 용어 | 정의 |
|---|---|
| **Workspace (워크스페이스)** | 서버 디스크상 프로젝트 루트들이 사는 `/workspaces` 영역. |
| **Web Push** | 브라우저 푸시 알림. P4에서 완료·승인·에러 알림에 사용. |

## 약어

| 약어 | 풀네임 | 의미 |
|---|---|---|
| ADR | Architecture Decision Record | 아키텍처 결정 기록 |
| API | Application Programming Interface | 애플리케이션 프로그래밍 인터페이스 |
| DoD | Definition of Done | 완료 기준 |
| MCP | Model Context Protocol | AI/도구 연동 표준 프로토콜 |
| NFR | Non-Functional Requirement | 비기능 요구사항 |
| P0~P7 | Phase 0~7 | 개발 로드맵 단계 |
| PR | Pull Request | 원격 저장소 변경 요청 |
| REST | Representational State Transfer | HTTP 기반 API 스타일 |
| VPS | Virtual Private Server | 가상 전용 서버 |
| WS / WSS | WebSocket / WebSocket Secure | 실시간 양방향 통신(암호화) |
