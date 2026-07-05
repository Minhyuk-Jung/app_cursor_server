# R-01 완화 모드 운영 가이드 (SDK 호스트 실행)

> 상태: 확정 · 최종 수정: 2026-07-04 · 관련: ADR-007, 04/13/16, 22-risks R-01, 00-overall-devplan §7.5
> 본 문서는 운영·배포 판단용이다. 애플리케이션 코드를 포함하지 않는다.

## 1. 목적

`@cursor/sdk` Local 런타임은 프로젝트 `cwd`(호스트 파일시스템)에서 AI 에이전트를 구동한다. ADR-007 **shared-runtime**(SDK in-container) 완료 전까지, **R-01 Critical** 위험을 명시적으로 수용·완화하는 운영 기준을 정의한다.

P6 종료 조건(23 §5) 중 「SDK 샌드박스 통합」은 **shared-path** 단계(동일 워크스페이스 bind mount + docker exec 터미널)까지를 의미하며, SDK 프로세스 자체의 컨테이ner 격리는 **shared-runtime** 후속이다.

---

## 2. 격리 모드 정의

| 모드 | `SANDBOX_MODE` | 터미널 exec | SDK 에이전트 | ADR-007 단계 |
|------|----------------|-------------|--------------|--------------|
| **완화(mitigation)** | `subprocess` (기본·개발) | 호스트 subprocess | 호스트 Local | `mitigation` |
| **shared-path** | `docker` | docker exec (컨테이너) | 호스트 Local (동일 mount) | `shared-path` |
| **shared-runtime-pending** | `docker` + `SDK_SHARED_RUNTIME=true` | docker exec | 호스트 Local (POC 요청·미구현) | `shared-runtime-pending` |
| **shared-runtime** | `docker` + `SDK_IN_CONTAINER=true` | docker exec | 컨테이ner (`ContainerSdkBridge`) | `shared-runtime` |

`/health` → `sandbox.adr007Phase`, `sandbox.mitigationMode`, `sandbox.sdkRunsOnHost`로 현재 정책을 확인한다.

---

## 3. 완화책 (04 §10 옵션 2, 13 §10)

### 3.1 인가·스코프
- 터미널·헤드리스 exec: `terminal:exec` 스코프 필수.
- AI run: `prompt:send` + 실행 중 승인(`approval_required`) 게이트.
- API 키·JWT는 프로젝트 소유자 범위로 제한(SEC-02).

### 3.2 경로·워크스페이스
- 파일 API·exec cwd·subprocess 명령: **프로젝트 rootPath 내부만** (SEC-01, SEC-04).
- SDK 생성·재개·캐시 hit 시 `assertProjectWorkspace` 재검증.

### 3.3 터미널 vs AI 출력 경계 (13 §8.1)
- 사용자 터미널 출력: WebSocket 직접 스트림 (**RunEventLog 미기록**).
- AI SDK 툴 출력: RunEventLog `tool` 이벤트.
- 동일 샌드박스/workspace를 공유하되 채널 분리.

### 3.4 docker 모드 (shared-path) 운영
- `NODE_ENV=production`이고 Docker 가용 시 **기본 `docker` 권장** (미설정 시 자동 선택).
- Docker 불가 + `SANDBOX_MODE=docker` → preview·세션 생성 **503** (`docker_unavailable`).
- 프로젝트별 `cursor-sb-*` 컨테이너: CPU/메모리 상한(`SANDBOX_CPUS`, `SANDBOX_MEMORY_MB`), 유휴 파기(`SANDBOX_IDLE_MS`).

### 3.5 수명·정리
- 유휴 sandbox purge, 프로젝트 **아카이브** 시: preview 토큰 폐기, exec 취소, 컨테이너 제거, SDK agent dispose, 터미널 WS 종료.
- 서버 **SIGTERM/SIGINT**: `shutdownApp` — sandbox 전체 purge + SDK dispose.

---

## 4. 운영 환경별 권장 설정

| 환경 | SANDBOX_MODE | 비고 |
|------|--------------|------|
| 로컬 개발 | `subprocess` (기본) | Docker 없이 빠른 iteration |
| CI (unit) | `subprocess` | docker job은 별도 workflow |
| CI / 스테이징 (P6 gate) | `docker` | SEC-04·S17 docker integration |
| **프로duction** | `docker` (Docker 필수) | subprocess는 R-01 미완화 — **기동 시 거부** (`assertProductionSandboxPolicy`) |

| SDK_SHARED_RUNTIME | false | ADR-007 shared-runtime POC (미구현 시 warn, sdkRunsOnHost=true) |

기동 정책:
- `NODE_ENV=production` + `SANDBOX_MODE=subprocess` → **프로세스 기동 실패** (escape: `ALLOW_SUBPROCESS_IN_PRODUCTION=true`)
- production + Docker 미가용 → **기동 실패** (Docker 설치 필수)
- 터미널 WS close code: **4410** = 프로젝트 아카이브, **4403** = 권한 거부 (`TERMINAL_WS_CLOSE`)

필수 env (16 §5 보완): `SANDBOX_MODE`, `SANDBOX_DOCKER_IMAGE`, `EXEC_TIMEOUT_MS`, `SANDBOX_MEMORY_MB`, `SANDBOX_CPUS`, `SANDBOX_IDLE_MS`, `PREVIEW_*`.

---

## 5. 잔여 위험 (수용 범위)

- **shared-path에서 SDK는 호스트에서 실행** — AI 툴의 셸·파일 접근이 OS 사용자 권한으로 가능. 완화책 §3으로 제한하나 **컨테이너 격리 수준은 아님**.
- subprocess 모드: 터미널 exec도 호스트 — **13 §10 위반**. production 사용 **금지**.
- 네트워크 이그레스 화이트리스트(13 §10): **미구현** — 온프렘 방화벽으로 보완.

---

## 6. P6 → P7 전환 조건

1. **shared-runtime** POC: SDK Agent를 프로젝트 컨테이너 내부에서 구동 (`SDK_IN_CONTAINER=true`, `SANDBOX_DOCKER_IMAGE`에 `@cursor/sdk` 포함). **POC 3 scaffold 완료** — send/stream/wait 통합 테스트·P6→P7 CI 게이트로 검증. production 기본은 여전히 shared-path; R-01 해소는 prod에서 shared-runtime 기본 적용 시.
2. NFR-23 docker 격리 E2E green (형제 프로젝트 접근 0건).
3. NFR-13 자원 상한 테스트 green.
4. 본 문서 §5 잔여 위험 중 SDK 호스트 실행 항목 **폐기** 또는 shared-runtime으로 대체.

---

## 7. 검증

- `/health` sandbox 블록 정책 필드.
- `21-test-strategy.md` P6 게이트: SEC-04, S17 E2E.
- docker integration: `p6-docker.integration.test.ts` (docker 환경).
- P6→P7: `p6-shared-runtime-api.spec.ts`, `p6-shared-runtime-ui.spec.ts`, `session-manager.shared-runtime.docker.test.ts`.

---

## 8. Production shared-runtime 전환 (ops Runbook)

**목표:** R-01 잔여 위험(§5 SDK 호스트 실행) 해소 — §6-4 충족.

### 8.1 전환 전 checklist
1. `docker build -t cursor-sandbox-sdk:prod apps/server/docker/sandbox-sdk` — `@cursor/sdk` 버전을 server `package.json`과 맞춤.
2. `/health` → `sandbox.adr007Phase=shared-runtime`, `sdkRunsOnHost=false` 확인.
3. P6→P7 CI: `p6-shared-runtime-api.spec.ts` green (`CURSOR_API_KEY` CI secret).
4. `SANDBOX_NETWORK_INTERNAL` **false** 유지(Cursor API 이그레스 필요).

### 8.2 production env (16 §12.1)
```
SANDBOX_MODE=docker
SDK_IN_CONTAINER=true
SANDBOX_DOCKER_IMAGE=cursor-sandbox-sdk:prod
# SANDBOX_NETWORK_INTERNAL=false  (기본)
CURSOR_API_KEY=<secret>
```

### 8.3 롤백
- `SDK_IN_CONTAINER=false` → shared-path(호스트 SDK)로 즉시 복귀. 컨테이ner 터미널 격리는 유지.
- R-01 완화 모드(§3) 재적용.

### 8.4 검증
- 프로젝트 생성 → 세션 생성 → prompt send → RunEventLog에 `run_done` 1회.
- `/health` sandbox 정책 필드.

