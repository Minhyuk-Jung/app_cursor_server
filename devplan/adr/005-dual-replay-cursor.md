# ADR-005: 이중 리플레이 커서 (seq + globalOffset)

> 상태: 확정 · 날짜: 2026-07-04

## 컨텍스트
`seq`는 run마다 1부터 초기화된다. project/global WebSocket 구독은 여러 run을 가로지른다. 단일 `lastSeq`로는 리플레이 정합성을 보장할 수 없다(R-02).

## 결정
- **run/session scope**: 커서 = `seq` (run 내 순번).
- **project/global scope**: 커서 = **`globalOffset`** (서버 전역 단조 증가).
- EventEnvelope에 둘 다 저장한다.

## 근거
- 단조 증가 커서 하나로 scope별 누락/중복 없이 재생 가능.
- 클라이언트는 구독 scope에 맞는 커서만 추적(15).

## 대안
- **시각 기반 안정 정렬만**: 동시 이벤트에서 순서 모호.
- **global만 사용**: run 단위 디버깅·세션 UI에서 불편.

## 결과
06/02/15/glossary 갱신. CH-01/LD-03 테스트 필수.
