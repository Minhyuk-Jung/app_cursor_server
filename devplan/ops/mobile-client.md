# ops — Mobile Native Client (P7 / 15 §14)

> **Expo React Native** — 웹과 동일하게 `/api/v1` REST + WS를 사용하는 API 우선 클라이언트.

## 1. 위치

- 앱: `apps/mobile` (`@app/mobile`)
- 실행: `npm run dev:mobile` 또는 `npm run start -w @app/mobile`

## 2. 차별 구현 이력

| 차수 | 범위 |
|------|------|
| **1차** | API 설정·프로젝트·세션·send_prompt REST |
| **2차** | WS 스트림·approval/cancel·pagination·Expo 토큰 stub |
| **3차** | Expo Push API·NotificationEngine·deeplink 수신 |
| **4차** | 인박스·deeplink 네비·푸시 탭 리스너·EAS projectId |
| **5차** | steer·사용량 탭·diff 리뷰(commit)·review_ready deeplink |
| **6차** | diff push/PR/rollback·usage 프로젝트별·quota 차단·steer 가드 |
| **7차** | **터미널 WS·프리뷰 URL**·**UR-15 첨부/음성(STT)**·프로젝트 탭 IA |
| **8차** | 터미널 **재연결·auto-scroll**·프리뷰 **WebView**·UR-15 **썸네일·카메라·10MB·전송복구·steer 음성** |
| **9차** | **파일 트리·뷰어(UR-02)**·`@app/shared` file-types·**Expo Receipt**·DiffScreen 포맷 |
| **10차** | UR-02 **검색·저장**·race fix·`file-api-paths`·Receipt **retry**·Maestro files smoke |
| **11차** | UR-02 **CRUD**·**Markdown 미리보기**·트리 **FlatList**·Maestro 확장 |
| **12차** | `@app/shared` **api-http**·**GitScreen**·Receipt **DB 영속화**·Markdown **코드블록·링크**·Maestro **풀 시나리오** |
| **13차** | web **api-http**·**Maestro CI gate**·Markdown **테이블·이미지**·P7 gate mobile full unit |
| **14차** | **api-fetch**·web api-keys fix·Receipt **idempotency**·Git **staged/unstaged**·Markdown **blockquote·Image**·Maestro gate **강화** |
| **15차** | **ClientApiError** web/mobile 통일·Receipt **FK cascade + orphan prune**·Markdown **autolink·italic**·**git deeplink**·Maestro **device CI scaffold** |
| **16차** | **shared deeplink**·**git_status** 알림·Markdown **_italic_/www**·Maestro **`--app-path`+APK build**·**orphan prune 스크립트**·App parseDeeplink import fix |
| **17차** | web **GitStatusPanel + git 탭**·inbox git 네비·Markdown **nested inline**·Maestro **adb + emulator runner** |
| **18차** | `@app/shared` **ProjectGitStatus**·Markdown **nested bold fix**·web **GitStatusPanel parity + renderMarkdown**·알림 **git_status 중복 제거**·Playwright **S29 git tab E2E**·Maestro **debug artifact** |
| **19차** | `@app/shared` **markdown-gfm**·GFM **strikethrough·task list** (web/mobile)·Maestro **mobile-git-flow**·**weekly emulator schedule** |
| **20차** | `@app/shared` **markdown-blocks**·web **renderMarkdown mobile parity**·GFM **ordered list**·**sanitizeMarkdownLinkHref**·**notification-git-enrich test**·Maestro **git testID assert** |
| **21차** | GFM **footnote**·**ProjectGitStatus ahead/behind/lastCommit**·Playwright **S30 markdown preview**·Maestro **mobile-markdown-flow**·adb install retry |
| **22차** | Git **upstream 미설정 UX**·mobile **footnote superscript+scroll**·**sanitizeMarkdownLinkHref mobile**·git **integration/IT**·S30 **code block·원문 토글**·Maestro **markdown 필수 assert** |
| **23차** | Maestro **run_device CI harness**·**mobile-api-setup**·**maestro-seed-project**·**adb reverse**·testID **nav/settings**·git/markdown **API 연동 flows** (6 flows) |
| **24차** | **maestroE2e push skip**·Maestro **GFM/upstream/inbox assert**·**extendedWaitUntil**·**api.integration upstream IT**·**maestro-e2e-fixtures**·7 flows gate |
| **25차** | **footnote measureLayout scroll**·**mobile-files/inbox-git flows**·**inbox git seed**·**mobile-device-suite**·CI **boot/animation hardening**·9 flows gate |
| **26차** | **Maestro auto-connect**·**suite subflows (no relaunch)**·**workflow gate**·CI **adb reverse + needs scaffold** |
| **27차** | **suite nav fix (settings-back/project-back)**·**maestro-emulator-ci.sh**·**run_device preflight** |
| **28차** | **inbox-git YAML fix**·**usage suite flow**·**seed idempotent**·**maestro-inbox-seed IT** |
| **29차** | **mobile-usage-flow**·**maestro-seed-lib + tsx seed**·**10 flows gate**·**CI cache/retry/PR scaffold** |

## 3. 29차 기능 상세

| 기능 | 상태 |
|------|------|
| mobile-usage-flow.yaml (standalone) | ✅ UR-14 |
| maestro-seed-lib.ts + unit test | ✅ |
| maestro-seed-project.ts (tsx, fixtures sync) | ✅ |
| Maestro gate 10 flows / >=10 asserts | ✅ |
| emulator-ci Maestro retry 1x | ✅ |
| workflow: Gradle cache + timeout 120m + PR scaffold | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow_dispatch 후속 |

## 4. 28차 기능 상세

| 기능 | 상태 |
|------|------|
| inbox-git-flow.yaml YAML formatting fix | ✅ |
| suite/usage-flow + inbox-screen testID | ✅ UR-14/06 |
| maestro-seed inbox idempotent (prune dupes) | ✅ |
| maestro-inbox-seed.integration.test.ts | ✅ |
| emulator-ci APK check + maestro --version | ✅ |
| maestro-gate YAML extendedWaitUntil lint | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow_dispatch 후속 |

## 4. 27차 기능 상세

| 기능 | 상태 |
|------|------|
| settings-back-btn / settings-open-btn | ✅ |
| project-back-btn (project screens) | ✅ |
| suite flows home 복귀 (single session) | ✅ |
| maestro-emulator-ci.sh (workflow script 추출) | ✅ |
| maestro-run-device-preflight.mjs | ✅ |
| Maestro --debug-output (device CI) | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow_dispatch 후속 |

## 4. 26차 기능 상세

| 기능 | 상태 |
|------|------|
| tryMaestroAutoConnect (DEFAULT_SETTINGS retry) | ✅ |
| mobile-api-setup auto-connect wait | ✅ |
| .maestro/suite/* subflows (single session) | ✅ |
| maestro-workflow-gate.mjs | ✅ |
| p7-gate workflow gate step | ✅ |
| CI adb reverse + needs maestro-scaffold | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow_dispatch 후속 |

## 4. 25차 기능 상세

| 기능 | 상태 |
|------|------|
| SimpleMarkdownView footnote scroll (measureLayout) | ✅ UR-02 |
| footnote-ref-{id} testID + Maestro tap assert | ✅ UR-02 |
| FilesScreen files-toolbar / add-file / add-dir testID | ✅ UR-02 |
| mobile-files-flow.yaml | ✅ UR-02 |
| maestro-seed inbox git_status (Maestro Git) | ✅ UR-06 |
| mobile-inbox-git-flow.yaml (deeplink → Git) | ✅ UR-06/07 |
| mobile-device-suite.yaml (single session run) | ✅ |
| CI emulator boot wait + animation disable | ✅ |
| Maestro gate 9 flows + device suite | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow 검증 후속 |

## 4. 24차 기능 상세

| 기능 | 상태 |
|------|------|
| app.config.js + EXPO_PUBLIC_MAESTRO_E2E (push 등록 skip) | ✅ |
| Maestro git-flow upstream 미설정 assert + wait | ✅ UR-07 |
| Maestro markdown GFM body + 편집 토글 assert | ✅ UR-02 |
| mobile-inbox-flow.yaml (home-tab-inbox) | ✅ UR-06 |
| api.integration upstream ahead/behind 0/0 IT | ✅ UR-07 |
| maestro-e2e-fixtures + link sanitize unit test | ✅ |
| Maestro gate 7 flows / >=7 required asserts | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow 검증 후속 |

## 4. 23차 기능 상세

| 기능 | 상태 |
|------|------|
| mobile-api-setup.yaml (clearState + settings-save) | ✅ |
| maestro-seed-project.mjs (maestro-e2e + README.md) | ✅ |
| maestro-device-ci: adb reverse + health wait + seed | ✅ |
| testID home-tab-projects / settings-save-btn / project-nav-* | ✅ |
| git/markdown flows API 연동 (maestro-e2e 프로젝트) | ✅ |
| p7-mobile-maestro-e2e: emulator 내 E2E server 기동 | ✅ |
| Maestro gate 6 flows / >=6 required asserts | ✅ |
| Maestro run_device CI green (실행 검증) | ⏳ workflow 검증 후속 |

## 4. 22차 기능 상세

| 기능 | 상태 |
|------|------|
| Git upstream null → "upstream 미설정" (web/mobile) | ✅ UR-07 |
| api.integration GET /git 새 필드 assert | ✅ |
| git-service upstream ahead/behind IT | ✅ |
| mobile footnote ref superscript + scroll-to-footnote | ✅ UR-02 |
| mobile sanitizeMarkdownLinkHref (link/image/autolink) | ✅ UR-02 |
| markdown-footnote unit test | ✅ |
| Playwright S30 code block·md-fn-ref·원문 토글 | ✅ |
| Playwright S29 git-upstream-sync hint | ✅ |
| Maestro mobile-markdown-flow 필수 assert 강화 | ✅ |
| Maestro run_device CI green (실행 검증) | ✗ 후속 |

## 4. 21차 기능 상세

| 기능 | 상태 |
|------|------|
| GFM footnote `[^id]` web/mobile + shared extract | ✅ UR-02 |
| ProjectGitStatus ahead/behind/lastCommitMessage | ✅ UR-07 |
| web/mobile Git UI 원격 동기·최근 커밋 | ✅ |
| Playwright S30 markdown preview E2E + p7-gate | ✅ |
| Maestro mobile-markdown-flow + gate 5 flows | ✅ |
| Maestro adb install retry (workflow) | ✅ |
| Maestro run_device CI green (실행 검증) | ✗ 후속 |

## 4. 20차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` markdown-blocks (code/table/blockquote) | ✅ |
| web renderMarkdown block parity + 빈 줄 보존 | ✅ UR-02 |
| GFM ordered list (web/mobile) | ✅ UR-02 |
| sanitizeMarkdownLinkHref (web) | ✅ |
| notification-git-enrich unit test | ✅ |
| Maestro git flow testID assert | ✅ |
| Maestro run_device CI green (실행 검증) | ✗ 후속 |

## 4. 19차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` parseTaskListLine + strikethrough helpers | ✅ |
| mobile SimpleMarkdownView GFM (~~del~~·`- [ ]`) | ✅ UR-02 |
| web renderMarkdown GFM + CSS | ✅ UR-02 |
| Maestro mobile-git-flow.yaml + gate 4 flows | ✅ |
| GitScreen testID git-status-panel | ✅ |
| p7-mobile-maestro-e2e weekly schedule (run_device) | ✅ |
| Maestro run_device CI green (실행 검증) | ✗ 후속 |

## 4. 18차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` ProjectGitStatus export | ✅ |
| mobile Markdown `**bold *inner* text**` INLINE_RE fix | ✅ UR-02 |
| web GitStatusPanel mobile parity (한국어·ApiError·로딩·hint) | ✅ UR-07 |
| web renderMarkdown italic/link/autolink + 테스트 | ✅ UR-02 |
| 알림 enrichCandidate git counts + dirty-only git_status | ✅ |
| Playwright S29 git tab UI E2E + p7-gate job | ✅ |
| Maestro workflow debug/APK artifact upload | ✅ |
| Maestro run_device CI green (실행 검증) | ✗ 후속 |

## 4. 17차 기능 상세

| 기능 | 상태 |
|------|------|
| web `getProjectGit` + `GitStatusPanel` | ✅ UR-07 |
| web 프로젝트 탭 Git + inbox git → git view | ✅ |
| Markdown nested inline (recursive bold/italic) | ✅ UR-02 |
| `hasNestedInlineMarkup` helper + 테스트 | ✅ |
| Maestro run mode adb device 검증 | ✅ |
| p7-mobile-maestro-e2e emulator runner | ✅ |
| Maestro run_device CI green (실행 검증) | ✗ 후속 |

## 4. 16차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` parseDeeplink + resolveInboxNavigation | ✅ |
| web/mobile deeplink 단일 원천 | ✅ |
| App.tsx parseDeeplink import fix | ✅ |
| NotificationEngine git_status + `/project/:id/git` | ✅ |
| web inbox git → diff 패널 | ✅ (17차: git 패널) |
| ClientApiError name + retryable getter | ✅ |
| mobile ApiError quota_exceeded 회귀 테스트 | ✅ |
| Markdown `_italic_` + www autolink | ✅ UR-02 |
| markdown-inline helper + 테스트 | ✅ |
| db:prune-receipt-orphans 스크립트 | ✅ |
| pruneOrphanReceiptPending warn log | ✅ |
| Maestro `--app-path` + 3 flows | ✅ |
| p7-gate device scaffold + workflow APK build | ✅ |
| Maestro emulator E2E green in CI | ✗ 후속 (run_device) |

## 5. 15차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` ClientApiError + throwClientApiError | ✅ |
| web/mobile ApiError → ClientApiError alias | ✅ |
| ExpoReceiptPending → ExpoPushToken FK (onDelete Cascade) | ✅ |
| pruneOrphanReceiptPending on resume | ✅ |
| Markdown autolink·italic (SimpleMarkdownView) | ✅ UR-02 |
| parseDeeplink `/project/:id/git` + App navigate | ✅ |
| Maestro `test:maestro:device:ci` + p7-mobile-maestro-e2e workflow | ✅ scaffold |
| Maestro 디바이스 E2E 실제 APK 실행 | ✗ 후속 (workflow_dispatch + artifact) |

## 6. 14차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` createApiFetch + mobile/web 적용 | ✅ |
| api-http invalid JSON → invalid_response | ✅ |
| web listApiKeys/create/delete apiFetch 버그 fix | ✅ |
| mobile ApiError.appError getter | ✅ |
| Expo receipt in-flight dedupe + persist warn log | ✅ |
| GET /git stagedCount·unstagedCount + GitScreen | ✅ |
| git status API IT (api.integration) | ✅ |
| Markdown blockquote·HR·Image preview | ✅ UR-02 |
| mobile-settings-flow + maestro gate >=3 asserts | ✅ |
| Maestro 디바이스 E2E in CI | ✗ 후속 |

## 7. 13차 기능 상세

| 기능 | 상태 |
|------|------|
| web `client.ts` → `@app/shared` parseJsonResponse | ✅ |
| web client-api-http.test.ts | ✅ |
| Maestro `scripts/maestro-gate.mjs` + test:maestro:ci | ✅ |
| p7-gate.yml mobile full unit + Maestro gate | ✅ |
| SimpleMarkdownView 테이블·이미지 | ✅ UR-02 |
| Maestro 디바이스 E2E in CI | ✗ 후속 |
| web apiFetch shared화 | ✗ 후속 |

## 8. 12차 기능 상세

| 기능 | 상태 |
|------|------|
| `@app/shared` parseJsonResponse (api-http) | ✅ mobile 적용 |
| GET `/api/v1/projects/:id/git` + getProjectGit | ✅ UR-07 |
| GitScreen + ProjectNavBar Git 탭 (5탭) | ✅ |
| ExpoReceiptPending Prisma + resumePendingReceipts | ✅ server |
| SimpleMarkdownView 코드블록·링크 | ✅ UR-02 |
| Maestro mobile-project-flow + test:maestro | ✅ |
| web client api-http 공유 | ✗ 후속 |
| Maestro CI gate (필수) | ✗ 후속 |

## 9. 11차 기능 상세

| 기능 | 상태 |
|------|------|
| createProjectFile / createProjectDir | ✅ UR-02 |
| deleteProjectFile / renameProjectFile | ✅ UR-02 |
| FilesScreen CRUD Modal + Alert 삭제 | ✅ |
| SimpleMarkdownView (h1-h3·list·bold·code) | ✅ UR-02 |
| Markdown 편집/미리보기 토글 | ✅ |
| flattenTree + FlatList 가상화 | ✅ |
| web/mobile REST client 본체 | ✗ 후속 |
| Maestro CI gate (풀) | ✗ 후속 |
| Receipt DB/queue 영속화 | ✗ 후속 |

## 10. 10차 기능 상세

| 기능 | 상태 |
|------|------|
| FilesScreen 검색 (`searchProject`) | ✅ UR-02 |
| FilesScreen 저장 (`saveProjectFile`) | ✅ UR-02 |
| 파일 로드 race fix (`loadSeq`) | ✅ |
| 트리 web parity (`tree.children`) | ✅ |
| tree/file 에러 분리 | ✅ |
| `@app/shared` file-api-paths | ✅ |
| Expo Receipt retry 30s/2m/5m | ✅ server |
| Markdown 렌더 | ✗ 후속 (원문+힌트) |
| 파일 CRUD (create/delete/rename) | ✗ 후속 |
| 대형 트리 가상화 | ✗ 후속 |
| web/mobile REST client 본체 | ✗ 후속 |
| Maestro CI gate (풀) | ✗ 후속 |

## 11. 9차 기능 상세

| 기능 | 상태 |
|------|------|
| FilesScreen (getProjectTree + getProjectFile) | ✅ UR-02 |
| ProjectNavBar 4탭 (세션·파일·터미널·리뷰) | ✅ 15 §33 |
| `@app/shared` TreeNode/FileContent | ✅ client 공유 1차 |
| Expo Push Receipt API (getReceipts + stale token prune) | ✅ |
| DiffScreen / TerminalScreen 포맷 정리 | ✅ |
| 파일 편집·검색 | ✗ 후속 |
| git 전용 탭 | ✗ 후속 (diff로 커버) |
| web/mobile REST client 공유 | ✗ 후속 |
| Maestro CI gate (풀 시나리오) | ✗ 후속 |

## 12. 8차 기능 상세

| 기능 | 상태 |
|------|------|
| useTerminalConnection (WS 재연결) | ✅ UR-09 |
| 터미널 출력 auto-scroll | ✅ UR-09 |
| WebView in-app preview + 브라우저 fallback | ✅ UR-10 |
| fetchAttachmentFileUri + MessageAttachmentImage | ✅ UR-15 |
| 카메라 촬영 첨부 | ✅ UR-15 |
| MAX_ATTACHMENT_BYTES 10MB 검증 | ✅ UR-15 |
| 전송 실패 시 text/attachments 복구 | ✅ UR-15 |
| steer 모드 음성(STT) | ✅ UR-15 |
| pending 첨부 chip + 제거 | ✅ UR-15 |
| userMessageDisplayContent + attachmentsJson reload | ✅ UR-15 |
| 파일 트리·git 탭 | ✅ 파일 9차 / git ✗ 후속 |
| web/mobile client 공유 | ✗ 후속 |
| Maestro CI gate (풀 시나리오) | ✗ 후속 |

## 13. 7차 기능 상세 (8차에서 보완됨)

| 기능 | 상태 |
|------|------|
| TerminalScreen (exec WS, stdin, cancel) | ✅ UR-09 (8차: 재연결·scroll) |
| issuePreview + Linking.openURL | ✅ UR-10 (8차: WebView in-app) |
| terminal deeplink | ✅ |
| ProjectNavBar (세션·터미널·변경 리뷰) | ✅ 15 §33 |
| Chat 이미지 첨부 (base64 upload) | ✅ UR-15 (8차: 썸네일·카메라·10MB·복구) |
| Chat 음성 (expo-av → `/stt/transcribe`) | ✅ UR-15 (8차: steer 모드 허용) |
| sendPrompt + attachments | ✅ |
| 파일 트리·git 탭 | ✅ 파일 9차 / git ✗ 후속 |
| web/mobile client 공유 | ✗ 후속 |

## 14. 하단 탭 (15 §35)

프로젝트 · 인박스 · 사용량

## 15. 테스트

```bash
npm run test -w @app/mobile
# Maestro 로컬: npm run test:maestro -w @app/mobile
# Maestro CI gate: npm run test:maestro:ci -w @app/mobile
# Maestro device CI scaffold: npm run test:maestro:device:ci -w @app/mobile
# Maestro workflow gate: npm run test:maestro:workflow:ci -w @app/mobile
# Maestro run_device preflight: npm run test:maestro:run-device:preflight -w @app/mobile
# FK 추가 전 orphan 정리: npm run db:prune-receipt-orphans -w @app/server
```

**STT:** 서버 `STT_STUB=true` 또는 `STT_API_URL` 필요.

## 16. devplan 추적

- UR-02 — mobile 파일 9~13차 (13차: Markdown 테이블·이미지)
- UR-09 — mobile 터미널 7~8차
- UR-10 — mobile 프리뷰 7~8차 (8차: WebView in-app)
- UR-15 — mobile 첨부/음성 7~8차 (8차: 썸네일·카메라·10MB·복구)
- UR-07/08/14/18 — 5~6차
