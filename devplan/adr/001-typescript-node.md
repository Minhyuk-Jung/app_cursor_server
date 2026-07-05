# ADR-001: TypeScript + Node LTS 백엔드

> 상태: 확정 · 날짜: 2026-07-04

## 컨텍스트
백엔드에서 Cursor SDK를 실행하고, REST/WebSocket/실시간 스트리밍을 제공해야 한다. Python SDK도 존재한다.

## 결정
백엔드는 **TypeScript + Node LTS**와 **`@cursor/sdk`** 를 사용한다.

## 근거
- WebSocket·async 스트리밍과 API 서버가 동일 런타임에서 자연스럽다.
- 프론트(React)와 `packages/shared` 타입 공유가 용이하다.
- Cursor SDK TypeScript 문서·Local 런타임이 본 프로젝트 요구와 맞는다.

## 대안
- **Python + cursor-sdk**: 데이터/ML 친화적이나, TS 프론트와 타입 공유·WS 서버 구성에서 이중 스택.
- **Go/Rust + REST API only**: SDK 공식 미지원, 에이전트 실행을 별도 프로세스로 분리해야 함.

## 결과
모노레po `apps/server`(TS), `packages/shared` 공유. Python은 본 프로젝트 범위 외.
