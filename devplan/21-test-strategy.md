# 통합 테스트 전략

> 상태: 확정 · 최종 수정: 2026-07-04 · 관련: `19-traceability.md`, `20-nfr.md`, `22-risks.md`, `components/*`
> 본 문서는 코드를 포함하지 않는다.

## 1. 목적
단위·통합·E2E·카오스·부하·보안 테스트를 **한 곳에서 정의**하고, 로드맵 단계별로 무엇을 검증하는지 명시한다. 각 구성요소 문서의 "테스트" 절은 본 문서의 하위 세트를 참조한다.

---

## 2. 테스트 피라미드

| 계층 | 비율(목표) | 범위 | 실행 빈도 |
|---|---|---|---|
| 단위 | ~60% | 순수 로직·검증 규칙·상태 전이표 | PR마다 |
| 통합 | ~30% | DB·RunEventLog·SessionManager·API | PR마다 |
| E2E | ~10% | 웹+API+SDK(또는 mock) 왕복 | 단계 종료·릴리스 |
| 카오스/부하/보안 | 별도 | NFR·리스크 기반 | 단계 종료·월 1회 |

---

## 3. 테스트 유형 정의

### 3.1 단위 테스트
- 대상: 01 검증 규칙, 07 전이표, 08 큐 로직, 17 멱등성 판정, 11 경로 안전.
- 원칙: 외부 I/O mock. SDK는 인터페이스 mock.

### 3.2 통합 테스트
- 대상: 06 저장→발행 순서, 05 실행 개시→이벤트 기록, 14 FK/유니크, 03 인가.
- 환경: 테스트 DB(SQLite), 테스트 워크스페이스 디렉터리.

### 3.3 E2E 테스트
- 대상: UR-01~04 핵심 플로우(프로젝트→세션→send→스트림→완료).
- 환경: 스테이징 VPS 또는 CI self-hosted runner + CURSOR_API_KEY(비밀).

### 3.4 카오스 테스트
| ID | 시나리오 | 기대 | NFR |
|---|---|---|---|
| CH-01 | run 중 WS 강제 종료 | 재연결 리플레이 정합 | NFR-04, NFR-05 |
| CH-02 | append 중 DB 일시 실패 | 미발행, 오류 반환 | SR-03 |
| CH-03 | send 중 프로세스 kill | 재시작 후 run error 마감 | NFR-16 |
| CH-04 | 중복 requestId 동시 2건 | 1회만 실행 | SR-08 |

### 3.5 부하 테스트
| ID | 시나리오 | 기대 | NFR |
|---|---|---|---|
| LD-01 | 동시 send N=maxConcurrent+5 | queued/429, running≤상한 | NFR-08 |
| LD-02 | 10 프로젝트 교차 send | 큐 안정, 누수 없음 | NFR-12 |
| LD-03 | globalOffset 리플레이 10k건 | ≤ NFR-04 | NFR-04 |

### 3.6 보안 테스트
| ID | 시나리오 | 기대 | NFR |
|---|---|---|---|
| SEC-01 | ../ 경로 탈출 | 403/400 | NFR-21 |
| SEC-02 | 타 사용자 projectId 접근 | 403 | NFR-20 |
| SEC-03 | 위조 웹훅 서명 | 거부 | SR-09 |
| SEC-04 | sandbox→타 프로젝트 파일 | 불가 | NFR-23 |

---

## 4. 로드맵 단계별 테스트 게이트

| 단계 | 필수 통과 테스트 | 게이트 |
|---|---|---|
| P0 | SDK 왕복 수동, CH-01(인메모리 리플레이) | PoC sign-off |
| P1 | CH-01, CH-04, SEC-02, 07 전이 전수, 06 저장→발행 | 코어 DoD |
| P2 | E2E UR-01~03, CH-01(WS), NFR-05 | 웹 슬라이스 |
| P3 | SEC-01, 11 읽기/쓰기, 첨부 업로드 | 파일 DoD |
| P4 | LD-01, LD-02, E2E S9(알림 mock), S29(어댑터) | 멀티 DoD |
| P5 | diff 리뷰 E2E, git push mock | Git DoD |
| P6 | SEC-04, S17 터미널 E2E, **exec_timeout·exec_memory_limit 인박스 E2E** (13 §9) | 샌드박스 DoD |
| P6→P7 | shared-runtime: bridge IT + SessionManager API/UI E2E (2nd send, cancel) | ADR-007 §6 |
| P7 | SEC-03, pull + MCP + UR-15 (… **Playwright S26/S27/S19/S28/S29/S30**, … **Maestro smoke yaml (10 flows + suite nav + emulator retry + preflight)**, **notification-git-enrich unit**, **web file-view-helpers markdown unit**, **P7 gate CI**) | 확장 DoD |

---

## 5. 테스트 데이터·환경

| 항목 | 규칙 |
|---|---|
| CURSOR_API_KEY | CI 비밀, 로그 마스킹 |
| 테스트 프로젝트 | `/tmp/test-workspaces` 또는 격리 볼륨 |
| DB | 테스트 전 migrate, 테스트 후 truncate |
| SDK | 통합/E2E는 real SDK, 단위는 mock |

---

## 6. 회귀·CI 정책
1. PR: 단위 + 통합 필수 green.
2. main merge: E2E subset(스모크) green.
3. 단계 릴리스 태그: 해당 단계 게이트 전체 green.
4. 실패 시: runId/agentId 로그로 RunEventLog 조회(운영 동일).

---

## 7. 구성요소별 테스트 문서 매핑

| 구성요소 | 본 문서 참조 |
|---|---|
| 01 | 3.1 검증 규칙 |
| 04 | P0 SDK 왕복, CH-03 |
| 05 | CH-03, LD-02, 3.2 |
| 06 | CH-01, CH-02, LD-03, 3.2 |
| 07 | 3.1 전이 전수 |
| 08 | LD-01, 3.1 |
| 11 | SEC-01, 3.2 |
| 13 | SEC-04, S17 |
| 17 | CH-04, 3.1 |

---

## 8. 오픈 이슈
- E2E에서 real SDK vs recorded mock 정책(CI 비용).
- k6/Artillery 등 부하 도구 선정.
