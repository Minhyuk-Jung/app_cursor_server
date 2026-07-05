# ops — Telegram pull 모드 Runbook (P7 / 10 §6.3)

## 목적

인바운드 웹훅이 불가한 환경에서 Telegram Bot API **getUpdates long polling**으로 ChatOps 명령을 수신한다.

> **참고:** 진짜 사내망(S31/UR-13)은 `INTRANET_MESSENGER_POLL_URL` 사내 API pull을 사용한다. Telegram pull은 **외부 Bot API egress**가 필요하다.

---

## 1. 활성화

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_PULL_MODE=true
TELEGRAM_POLL_INTERVAL_MS=1000
TELEGRAM_LONG_POLL_TIMEOUT_SEC=25
TELEGRAM_POLL_MAX_BACKOFF_MS=60000
```

기동 시:

1. `deleteWebhook` 호출 (push 비활성)
2. `{WORKSPACE_ROOT}/.server-state/telegram-poll-offset.json` 에서 offset 복원
3. update **건별** 처리 후 offset commit (`update_id + 1`)
4. `requestId=telegram:update:{id}` 로 CommandHandler 멱등

---

## 2. push와의 관계

| 모드 | 인바운드 | `/api/v1/webhooks/telegram` |
|---|---|---|
| push (기본) | Telegram → 서버 webhook | **사용** |
| pull | 서버 → getUpdates | **409 conflict** (비활성) |

`TELEGRAM_PULL_MODE=true` + `TELEGRAM_WEBHOOK_SECRET` 동시 설정 시 기동 **warn** (secret 무시).

---

## 3. 검증

1. `/health` → `channels.telegram.inboundMode=pull`, `pull.running=true`
2. channel-link 연결 후 `/dev status` 전송 → 응답 또는 run_done 아웃바운드
3. 테스트: `npx vitest run src/adapters/telegram src/adapters/intranet src/adapters/shared`

---

## 4. 사내 메신저 pull (S31)

```env
INTRANET_MESSENGER_POLL_URL=https://messenger.internal/api/v1/messages
INTRANET_MESSENGER_POLL_INTERVAL_MS=3000
INTRANET_MESSENGER_AUTH_HEADER=Bearer ...
INTRANET_MESSENGER_NOTIFY_URL=https://messenger.internal/api/v1/reply   # optional
```

Poll 응답 JSON:

```json
{
  "messages": [{ "id": "msg-1", "chatId": "user-42", "text": "/dev status" }],
  "cursor": "msg-1"
}
```

channel-link: `{ "channel": "intranet", "externalUserId": "<chatId>" }`

---

## 5. 운영 주의

- **단일 인스턴스**만 동일 bot token으로 pull (다중 인스턴스는 offset 경쟁)
- offset 파일은 **백업 대상** (`workspace/.server-state/`)
- graceful shutdown: `shutdownApp`이 poll loop 종료 대기

---

## 6. 관련 devplan

- `components/10-channel-adapters.md` §6.3, §13
- `components/16-infra-deployment.md` §8, §12.1
- `21-test-strategy.md` P7 게이트
