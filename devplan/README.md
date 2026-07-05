# 개발계획서 (devplan)

> devplan 버전: **v1.2** · 최종 수정: 2026-07-04 · 변경 이력: [`CHANGELOG.md`](./CHANGELOG.md)

Cursor SDK 기반 **원격 개발 서버**의 개발계획서 모음입니다.

## 문서 구성 (3계층)

| 계층 | 설명 |
|---|---|
| **전체** | 아키텍처·로드맵·보안·배포 |
| **구성요소** | 각 모듈의 상세 설계도 (코드 제외) |
| **보조** | 시나리오·추적·NFR·테스트·위험·ADR·용어·컨벤션 |

---

## 1. 전체 개발계획서

- [`00-overall-devplan.md`](./00-overall-devplan.md) — 아키텍처·레이어·상호작용·데이터·로드맵·보안·배포

---

## 2. 구성요소별 (`components/`)

### 공통
| 번호 | 문서 | 구성요소 |
|---|---|---|
| 01 | [`01-shared-contracts.md`](./components/01-shared-contracts.md) | 공유 계약 (Command/DomainEvent) |

### API · 어댑터
| 번호 | 문서 | 구성요소 |
|---|---|---|
| 02 | [`02-api-layer.md`](./components/02-api-layer.md) | API 레이어 (REST/WS/Webhook/MCP) |
| 03 | [`03-auth.md`](./components/03-auth.md) | 인증/인가 |
| 10 | [`10-channel-adapters.md`](./components/10-channel-adapters.md) | 채널 어댑터 (통합) |

### 코어
| 번호 | 문서 | 구성요소 |
|---|---|---|
| 04 | [`04-sdk-adapter.md`](./components/04-sdk-adapter.md) | SdkAdapter |
| 05 | [`05-session-manager.md`](./components/05-session-manager.md) | SessionManager |
| 06 | [`06-run-event-log.md`](./components/06-run-event-log.md) | RunEventLog / 이벤트 버스 |
| 07 | [`07-state-machine.md`](./components/07-state-machine.md) | 상태머신 |
| 08 | [`08-scheduler.md`](./components/08-scheduler.md) | 스케줄러 |
| 09 | [`09-notification-engine.md`](./components/09-notification-engine.md) | 알림 정책 엔진 |
| 11 | [`11-file-service.md`](./components/11-file-service.md) | 파일 서비스 |
| 12 | [`12-git-service.md`](./components/12-git-service.md) | Git 서비스 |
| 13 | [`13-terminal-preview.md`](./components/13-terminal-preview.md) | 터미널/프리뷰 (샌드박스) |
| 17 | [`17-command-handler.md`](./components/17-command-handler.md) | Command 처리기 |

### 클라이언트 · 인프라
| 번호 | 문서 | 구성요소 |
|---|---|---|
| 15 | [`15-frontend.md`](./components/15-frontend.md) | 프론트엔드 (웹/모바일 PWA) |
| 14 | [`14-data-model.md`](./components/14-data-model.md) | 데이터 모델 / DB |
| 16 | [`16-infra-deployment.md`](./components/16-infra-deployment.md) | 인프라/배포/운영 보안 |

---

## 3. 보조 문서

| 문서 | 용도 |
|---|---|
| [`glossary.md`](./glossary.md) | 용어집 (단일 정의) |
| [`18-scenarios.md`](./18-scenarios.md) | 사용자 시나리오 카탈로그 (S1~S32) |
| [`19-traceability.md`](./19-traceability.md) | 요구사항 추적 매트릭스 (UR/SR) |
| [`20-nfr.md`](./20-nfr.md) | 비기능 요구사항 (수치 목표) |
| [`21-test-strategy.md`](./21-test-strategy.md) | 통합 테스트 전략 |
| [`22-risks.md`](./22-risks.md) | 위험 관리 대장 |
| [`conventions.md`](./conventions.md) | 개발 표준/컨벤션 |
| [`23-implementation-dependency.md`](./23-implementation-dependency.md) | 구현 의존성·마일스톤 |
| [`adr/`](./adr/README.md) | 아키텍처 결정 기록 (ADR 001~008) |
| [`ops/r01-mitigation-mode.md`](./ops/r01-mitigation-mode.md) | R-01 SDK 호스트 실행 완화 모드 운영 (P6 필수) |
| [`CHANGELOG.md`](./CHANGELOG.md) | devplan 변경 이력 |

---

## 읽는 순서 (권장)

1. `00-overall-devplan.md` — 전체 그림
2. `glossary.md` — 용어 정렬
3. `01-shared-contracts.md` — 정규 타입
4. `23-implementation-dependency.md` — P1 내부 순서
5. 코어 뼈대: `06` → `07` → `05` → `04` → `08` → `17`
6. `18-scenarios.md` + `19-traceability.md` — 요구·시나리오 대조
7. 구현 단계별: `20-nfr`, `21-test-strategy`, `22-risks`, `conventions`
8. 해당 단계 구성요소 문서

---

## 문서 규약 (중요)

- 모든 문서는 **한국어**로 작성한다.
- **구성요소별 상세개발계획서는 "실제 개발 상세설계도" 역할을 한다.** 저급 LLM 모델이 더 이상의 설계 판단 없이 그대로 따라 구현할 수 있을 만큼 상세해야 한다.
- **예시 코드·타입 코드·의사코드(pseudocode)를 일절 포함하지 않는다.** 표와 번호 매긴 절차 서술로 기술한다.
- **mermaid 다이어그램**은 허용한다.
- **문서 메타**: 상단에 `상태` · `최종 수정` · `관련 문서`를 포함한다 (`conventions.md` §10).
- 단계 표기 **P0~P7**은 `00-overall-devplan.md` 로드맵을 따른다.
- 아키텍처 결정 변경 시 **ADR 추가** 후 `CHANGELOG.md` 갱신.
