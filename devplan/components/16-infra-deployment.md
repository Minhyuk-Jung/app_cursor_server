# 구성요소 상세개발계획서 — 16. 인프라 / 배포 / 운영 보안

> 위치: 배포 구성·운영 · 레이어: 인프라 · 단계: P1(기본) → 단계별 강화
> 관련 문서: 04(SDK 실행 격리) · 13(샌드박스) · 14(DB) · 03(시크릿/인증)
> 본 문서는 코드/스크립트를 포함하지 않는다.

## 1. 개요 및 책임
서버(코어+API+어댑터)와 프론트엔드를 사용자 통제 환경(VPS 또는 사내 온프렘)에 **안전하게 구동·노출·운영**하기 위한 구성을 정의한다. 프로세스 관리, 리버스 프록시/TLS, 환경변수·시크릿, DB, 워크스페이스 저장, 샌드박스 런타임, 백업, 관측을 포함한다.

## 2. 범위
- 포함: 실행 환경, 프로세스 관리, 프록시·TLS, 시크릿 관리, DB 운영, 워크스페이스 저장, 샌드박스 런타임, 백업·복구, 로깅·관측, 온프렘 특수 사항.
- 제외: 애플리케이션 로직(각 구성요소 문서).

## 3. 의존성
- 상위: 모든 서버 구성요소가 이 환경 위에서 구동.
- 하위: OS·컨테이너 런타임·DB 엔진·프록시.

## 4. 구성 요소
| 구성 요소 | 역할 |
|---|---|
| 런타임 | Node LTS + `@cursor/sdk` 구동 |
| 프로세스 관리자 | 서버 프로세스 구동·재시작·로그 |
| 리버스 프록시 | TLS 종단·라우팅(자동 HTTPS 권장) |
| 시크릿 저장 | 비밀값 안전 보관·주입 |
| DB 엔진 | 운영 Postgres / 개발 SQLite |
| 워크스페이스 저장 | 프로젝트 파일·git 보관 |
| 샌드박스 런타임 | 터미널/프리뷰 **및 SDK 에이전트 실행**의 프로젝트별 격리 컨테이너 |
| 백업 시스템 | 워크스페이스·DB 정기 백업 |
| 관측 스택 | 구조적 로그·헬스체크·지표 |

## 5. 환경 변수·시크릿(항목)
| 이름 | 용도 | 비고 |
|---|---|---|
| CURSOR_API_KEY | SDK 인증 | 시크릿 매니저 경유, 클라이언트 노출 금지 |
| JWT_SECRET | 사용자 토큰 서명 | 회전 관리 |
| DATABASE_URL | DB 접속 | 환경별 분리 |
| 채널 토큰 | 메신저 연동 | 채널별, 온프렘 외부 유출 금지 |
| 웹훅 서명 키 | 인/아웃바운드 서명 | HMAC |

## 6. 배포 절차(개념 단계)
1. 런타임·의존성 설치.
2. 환경 변수·시크릿 주입(시크릿 매니저).
3. DB 마이그레이션 적용.
4. 서버를 프로세스 관리자로 구동(재시작 정책 포함).
5. 리버스 프록시로 HTTPS/WSS 종단·라우팅 구성.
6. 프론트엔드 빌드 산출물 정적 서빙.
7. 헬스체크·로그·백업 활성화.

## 7. 네트워크·노출 구성
| 항목 | 규칙 |
|---|---|
| 전송 | HTTPS/WSS 강제 |
| 포트 | 프록시만 외부 노출, 앱·DB는 내부 |
| CORS | 허용 출처 명시 |
| 프리뷰 프록시 | 인증·만료 토큰 URL |

## 8. 온프렘(사내망) 특수 사항
- 내부망 TLS(사설 CA) 구성.
- 인바운드 웹훅 수신이 어려우면 어댑터를 **풀(pull) 방식**으로 구성(서버가 채널 API로 나가는 연결).
- 시크릿·코드가 외부로 나가지 않도록 이그레스 제한.
- 자체 DB·저장소를 내부에 둔다.

## 9. 백업·복구
- 대상: 워크스페이스(코드+git), DB.
- 주기: 정기 스냅샷 + 변경분.
- 복구 훈련: 정기적으로 복원 절차 검증.

## 10. 관측·운영
- 실행마다 runId/agentId를 구조적 로그로 남긴다(스트림 시작 전).
- 헬스체크 엔드포인트, 자원 사용량 지표, 에러율 모니터링.
- 스케줄러 대기열 길이·동시 실행 수를 지표화.

## 11. 보안 고려사항(운영)
- 최소 노출: 프록시 외 포트 폐쇄.
- 시크릿은 저장소·로그에 평문 미기록.
- 정기 의존성 취약점 점검·업데이트.
- 샌드박스 이그레스 제한·격리 유지.
- **SDK 에이전트 실행 격리**: AI 에이전트(SDK Local 런타임)의 툴 실행이 호스트에서 무격리로 수행되지 않도록, 사용자 터미널과 동일한 프로젝트별 샌드박스에서 구동한다. 컨테이너 구동이 불가한 초기 단계는 전용 OS 사용자·제한 경로·이그레스 제한으로 완화하고 한계를 문서화한다(상세 04/13).
- 접근 감사 로그 보존.

## 12. 구성/설정값
- 재시작 정책, 프록시 인증서 설정, 백업 주기·보존, 로그 레벨·보존, 헬스체크 주기, 자원 상한(스케줄러/샌드박스와 정합).

### 12.1 샌드박스·터미널 env (P6, 13·ops/r01)
| 변수 | 기본 | 의미 |
|---|---|---|
| SANDBOX_MODE | subprocess (dev) / docker (prod) | subprocess \| docker |
| SANDBOX_DOCKER_IMAGE | node:22-alpine | 격리 컨테이ner 이미지 |
| EXEC_TIMEOUT_MS | 300000 | exec 시간 상한 |
| SANDBOX_MEMORY_MB | 512 | 컨테이ner 메모리 |
| SANDBOX_CPUS | 1 | 컨테이ner CPU |
| SANDBOX_IDLE_MS | 600000 | 유휴 sandbox 파기 |
| PREVIEW_TOKEN_TTL_SEC | 3600 | 프리뷰 토큰 TTL |
| PREVIEW_PORT_MIN/MAX | 3000/9999 | 프리뷰 포트 범위 |
| ALLOW_SUBPROCESS_IN_PRODUCTION | (미설정) | R-01 escape hatch |
| SDK_SHARED_RUNTIME | false | ADR-007 shared-runtime-pending (호스트 SDK + 컨테이ner 준비 검증) |
| SDK_IN_CONTAINER | false | ADR-007 POC 3 — SDK in-container (`ContainerSdkBridge`) |
| SANDBOX_NETWORK_INTERNAL | false | docker 네트워크 이그레스 차단 — **`SDK_IN_CONTAINER`와 상호 배타** |
| TELEGRAM_BOT_TOKEN | (미설정) | Telegram bot |
| TELEGRAM_PULL_MODE | false | true → getUpdates pull (`ops/telegram-pull-mode.md`) |
| TELEGRAM_POLL_INTERVAL_MS | 1000 | pull 오류·idle 간격 |
| TELEGRAM_LONG_POLL_TIMEOUT_SEC | 25 | getUpdates long poll timeout |
| TELEGRAM_POLL_MAX_BACKOFF_MS | 60000 | poll backoff 상한 |
| TELEGRAM_WEBHOOK_SECRET | (미설정) | push 모드 webhook 검증 (pull 시 무시) |
| INTRANET_MESSENGER_POLL_URL | (미설정) | S31 사내 메신저 pull API |
| INTRANET_MESSENGER_POLL_INTERVAL_MS | 3000 | 사내 poll 주기 |
| INTRANET_MESSENGER_NOTIFY_URL | (미설정) | S31 사내 reply POST (optional) |
| SESSION_SUMMARY_LLM | false | UR-16 LLM 세션 요약 opt-in |
| STT_STUB | (미설정) | 테스트용 STT stub |
| STT_API_URL | (미설정) | UR-15 외부 STT API (multipart forward) |
| STT_API_KEY | (미설정) | STT upstream Bearer (optional) |
| MCP_ENABLED | (prod: false, dev: true) | production opt-in — `true` 시 `/api/v1/mcp` 활성 (`ops/mcp-mode.md`) |

## 13. 테스트 전략
- 배포 리허설(스테이징)에서 마이그레이션·구동·프록시 검증.
- 장애 주입: 프로세스 강제 종료 후 자동 재시작.
- 백업→복원 검증.
- 보안 점검: 포트 스캔·시크릿 유출·TLS 설정.

## 14. 개발 순서 / 완료 기준(DoD)
- P1: 단일 VPS 기본 배포(런타임·프록시·DB·프로세스 관리). DoD: HTTPS로 서비스 구동·헬스체크 정상.
- 단계별: 샌드박스 런타임(P6), 온프렘 구성(확장), 백업·관측 강화.

## 15. 오픈 이슈
- 단일 서버→다중 서버 확장 시 세션 상태·대기열 분산.
- 컨테이너 오케스트레이션 도입 여부.
