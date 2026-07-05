# Cursor Remote Dev Server

Cursor SDK 기반 원격 개발 서버 (devplan v1.2 구현).

## 빠른 시작

```bash
npm install
cp apps/server/.env.example apps/server/.env
# CURSOR_API_KEY 설정 (SDK 사용 시)
npm run db:push -w @app/server
npm run build
npm run p0      # P0 스파이크 (이벤트 로그 PoC + SDK 라운드트립)
npm run dev     # P1 API 서버 (http://localhost:3000)
```

## API (P1)

인증: `Authorization: Bearer <DEV_API_KEY>`

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/v1/projects` | 프로젝트 생성 |
| GET | `/api/v1/projects` | 프로젝트 목록 |
| POST | `/api/v1/projects/:id/sessions` | 세션 생성 |
| POST | `/api/v1/sessions/:sid/messages` | 프롬프트 전송 (202=queued) |
| GET | `/api/v1/events/replay` | 이벤트 리플레이 |
| WS | `/api/v1/stream` | 실시간 이벤트 스트림 |
| POST | `/api/v1/commands` | 정규 Command (어댑터용) |

## 구조

| 경로 | 구성요소 |
|---|---|
| `packages/shared` | 01 공유 계약 |
| `apps/server/src/core/eventlog` | 06 RunEventLog |
| `apps/server/src/core/state` | 07 상태머신 |
| `apps/server/src/core/sdk` | 04 SdkAdapter |
| `apps/server/src/core/session` | 05 SessionManager |
| `apps/server/src/core/scheduler` | 08 스케줄러 |
| `apps/server/src/auth` | 03 인증 |
| `apps/server/src/command` | 17 Command 처리기 |
| `apps/server/src/api` | 02 API 레이어 |
| `apps/web` | 15 프론트엔드 (P2 채팅·P3 파일·PWA) |
| `apps/server/src/services/file` | 11 파일 서비스 (P3) |

상세 설계: [`devplan/README.md`](devplan/README.md)

## P2 웹 클라이언트

```bash
# 터미널 1: API 서버
npm run dev

# 터미널 2: 웹 (Vite 프록시 → :3000)
npm run dev:web
```

브라우저: http://localhost:5173 — 설정에서 API 키(`dev-local-key`) 확인.  
세션 생성·프롬프트 실행에는 서버 `.env`의 `CURSOR_API_KEY` 필요.
