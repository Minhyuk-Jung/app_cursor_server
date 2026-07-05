# ADR-002: Cursor SDK Local 런타임

> 상태: 확정 · 날짜: 2026-07-04

## 컨텍스트
Cursor SDK는 Local(호스트 cwd)과 Cloud(원격 VM, PR 중심) 런타임을 제공한다. 사용자는 IDE 없이 VPS에서 **파일 트리·실시간 편집·세션 지속**을 원한다.

## 결정
**Local 런타임**만 사용한다. `Agent.create` 시 `local: { cwd }`를 **항상 명시**한다.

## 근거
- 프로젝트 파일이 VPS 워크스페이스에 있어야 파일 서비스·git·뷰어와 일치한다.
- Cloud는 PR 워크플로우에 적합하나, IDE-like 실시간 경험과 거리가 있다.
- 사용자가 서버를 통제(셀프호스팅)한다는 목표와 부합한다.

## 대안
- **Cloud only**: Cursor iOS와 유사하나, 셀프호스팅·자체 API 목표와 충돌.
- **하이브리드**: 긴 작업 Cloud 오프로드 — P7 이후 검토(R-15).

## 결과
SdkAdapter(04)는 Local 전용. Cloud 필드 미사용.
