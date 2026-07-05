# 요구사항 추적 매트릭스 (Traceability)

> 상태: 확정 · 최종 수정: 2026-07-04 · 관련: `18-scenarios.md`, `00-overall-devplan.md`, `20-nfr.md`
> 본 문서는 코드를 포함하지 않는다.

## 1. 목적
사용자·시스템 요구사항이 **어떤 구성요소·로드맵 단계·완료기준(DoD)** 으로 충족되는지 추적한다. 범위 누락 방지와 릴리스 검증의 기준표이다.

## 2. ID 체계
| 접두 | 의미 | 예 |
|---|---|---|
| UR | 사용자 요구사항 | UR-01 |
| SR | 시스템 요구사항 | SR-01 |
| SC | 시나리오 (18 참조) | S11 |

---

## 3. 사용자 요구사항 추적

| ID | 요구사항 | 시나리오 | 구성요소 | 단계 | DoD 요약 |
|---|---|---|---|---|---|
| UR-01 | Cursor IDE 없이 원격 개발 | S1, S20 | 04, 05, 02, 15 | P0~P2 | SDK 왕복 + 웹 채팅 E2E · **Expo mobile REST+WS 2차** |
| UR-02 | 파일 트리·뷰어·편집 | S15 | 11, 02, 15 | P3 | 트리·읽기·저장·경로방어 · **mobile 9~25차 · web markdown block parity 20차 · Maestro files 25차** |
| UR-03 | AI 채팅·실시간 작업 관찰 | S12 | 05, 06, 04, 15 | P2 | 스트림 + 작업현황 패널 · **mobile WS 2차** |
| UR-04 | 연결 끊김 후 이어 보기 | S11 | 06, 02, 15 | P1~P2 | 리플레이 중복/누락 0 |
| UR-05 | 여러 프로젝트 병렬 | S5, S6 | 08, 07, 14 | P4 | 상한·큐·전역 실행중 뷰 |
| UR-06 | 전역 인박스·완료 알림 | S9, S10 | 09, 07, 15 | P4 | 인박스 + Web Push · **mobile Expo+인박스 4차 · git_status deeplink 16·25차 Maestro** |
| UR-07 | Git 커밋·푸시·PR | S2, S16 | 12, 02, 15 | P5 | commit/push/PR · **mobile git 12~24차 (upstream UX·API IT) · web GitStatusPanel 17~21차** |
| UR-08 | diff 변경 리뷰 승인 | S16 | 12, 15, 09 | P5 | 파일별 approve/reject · **mobile diff 5~6차** |
| UR-09 | 터미널·빌드/테스트 | S17 | 13, 02, 15 | P6 | 샌드박스 실행·출력 스트림 · **mobile terminal 7~8차** |
| UR-10 | 라이브 프리뷰 | S17 | 13, 02 | P6 | 인증된 preview URL · **mobile preview 7~8차 (WebView)** |
| UR-11 | 메신저로 명령·알림 | S29, S30 | 10, 17, 09 | P4 | 1채널 왕복 |
| UR-12 | 자체 공개 API | S32 | 02, 17, 03 | P1~P4 | /api/v1 + API키 |
| UR-13 | 온프렘/사내망 배포 | S31 | 16, 10 | P1, P7 | pull + **UUID v5 requestId** + real-path IT |
| UR-14 | 사용량·예산 인지 | S23, S24 | 17, 14, 15 | P4 | 집계 + 상한 차단 · **mobile usage 5~6차** |
| UR-15 | 음성·이미지 입력 | S26, S27 | 15, 11, **04**, **14**, **02** | P7 | STT stub/**STT_API_URL** + Web multipart + **mobile 첨부/음성 7~8차** + S26/S27 E2E |
| UR-16 | 세션 복귀 요약 | S19 | 05, 14, 15 | P1~P7 | **rule + LLM opt-in** · **S19 Playwright** · SessionManager IT |
| UR-17 | 실행 중 승인 | S13 | 07, 09, 06, 15 | P1~P4 | approval_required UI · **mobile 2차** |
| UR-18 | run 취소·steer | S14 | 05, 17, 02 | P1 | cancel/steer API · **mobile cancel 2차 + steer 5~6차** |

---

## 4. 시스템 요구사항 추적

| ID | 요구사항 | 구성요소 | 단계 | DoD 요약 | NFR 참조 |
|---|---|---|---|---|---|
| SR-01 | 헤드리스 코어, API 우선 | 17, 02, 01 | P1 | 웹=API 클라이언트만 | — |
| SR-02 | 정규 Command/DomainEvent | 01 | P1 | shared 패키지 빌드 | — |
| SR-03 | 이벤트 저장 후 발행 | 06 | P0~P1 | 저장 실패 시 미발행 | NFR-03 |
| SR-04 | 이중 리플레이 커서 | 06, 02, 15 | P1 | seq + globalOffset | NFR-04 |
| SR-05 | 상태 전이 단일 원천 | 06, 07 | P1 | RunEventLog 소비만 | — |
| SR-06 | run↔연결 분리 | 05, 06, 08 | P1 | WS 끊어도 run 지속 | NFR-05 |
| SR-07 | 동시 실행 상한·큐 | 08 | P1~P4 | 부하 테스트 통과 | NFR-06 |
| SR-08 | 멱등성(requestId) | 17, 01 | P1 | 중복 1회만 실행 | — |
| SR-09 | JWT + API키 + 스코프 | 03 | P1~P4 | 401/403 정확 | NFR-08 |
| SR-10 | WS 브라우저 인증 | 02, 03 | P1~P2 | 3방식 중 1 채택 | — |
| SR-11 | 경로 탈출 방어 | 11 | P3 | ../ 차단 테스트 | NFR-09 |
| SR-12 | SDK+터미널 샌드박스 격리 | 04, 13, 16 | P1~P6 | 프로젝트 간 격리 | NFR-07 |
| SR-13 | 서버 재시작 안전 마감 | 05, 07 | P1 | 미종료 run error 마감 | — |
| SR-14 | API 버저닝 /api/v1 | 02 | P1 | 경로 접두어 고정 | — |
| SR-15 | 멀티프로젝트 seam | 14, 01 | P1 | source/channel/projectId | — |
| SR-16 | 첨부 blob 저장 | 11, 02 | P3 | upload/ref 조회 | — |
| SR-17 | Cursor 쿼터 대체 | 14, 17 | P4 | 자체 UsageEvent | UR-14 |

---

## 5. 로드맵 단계별 시나리오 커버리지

| 단계 | 필수 충족 UR | 필수 충족 SC | 출시 가능 정의 |
|---|---|---|---|
| P0 | — | — | SDK+리플레이 PoC |
| P1 | UR-01(부분), UR-04, UR-17, UR-18 | S11, S13, S14 | 1프로젝트 코어 뼈대 |
| P2 | UR-01, UR-03, UR-04 | S11, S12 | 웹 채팅 E2E |
| P3 | UR-02 | S15, S27 | 파일 IDE 체감 |
| P4 | UR-05, UR-06, UR-11, UR-14 | S5~S10, S29 | 멀티+인박스+메신저 |
| P5 | UR-07, UR-08 | S2, S16, S8 | Git 완결 |
| P6 | UR-09, UR-10 | S17 | 검증 루프 |
| P7 | UR-13, UR-15 | S26, S31 | 확장 |

---

## 6. 구성요소→요구사항 역매핑 (요약)

| 구성요소 | 주요 충족 UR/SR |
|---|---|
| 01 | SR-02, SR-15 |
| 02 | UR-01, UR-12, SR-10, SR-14, **MCP Streamable HTTP (P7)** |
| 03 | UR-12, SR-09 |
| 04 | UR-01, SR-12 |
| 05 | UR-01, UR-03, UR-16, UR-18, SR-06, SR-13 |
| 06 | UR-03, UR-04, SR-03, SR-04, SR-05 |
| 07 | UR-05, UR-17, SR-05 |
| 08 | UR-05, UR-14, SR-07 |
| 09 | UR-06, UR-08, UR-17 |
| 10 | UR-11, UR-13, **MCP tools → CommandHandler (P7)** |
| 11 | UR-02, UR-15, SR-11, SR-16 |
| 12 | UR-07, UR-08 |
| 13 | UR-09, UR-10, SR-12 |
| 14 | UR-14, SR-15, SR-17 |
| 15 | UR-01~UR-03, UR-06, **UR-15 음성·이미지 첨부 (P7)** |
| 16 | UR-13, SR-12 |
| 17 | UR-11, UR-12, UR-14, UR-18, SR-01, SR-08 |

---

## 7. 검증 게이트
1. 단계 종료 전: 해당 단계 "필수 충족 UR" 전부 DoD 통과 확인.
2. 릴리스 전: `21-test-strategy.md` 해당 단계 테스트 세트 green.
3. 요구사항 변경 시: 본 표·`18-scenarios.md`·구성요소 문서 동시 갱신.

## 8. 오픈 이슈
- UR-15(P7) vs UR-02(P3) 우선순위 충돌 시 범위 조정 절차.
- SR-12 SDK 샌드박스: P6 전 완화 모드 문서화 필요(04/16).
