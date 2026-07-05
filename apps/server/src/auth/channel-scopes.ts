import { Scope as ScopeEnum } from "@app/shared";

/** 03 §6.4: 메신저 채널 — 읽기·쓰기·프롬프트·취소·승인·터미널 exec(P6) */
export const TELEGRAM_CHANNEL_SCOPES = [
  ScopeEnum.PROJECT_READ,
  ScopeEnum.PROJECT_WRITE,
  ScopeEnum.PROMPT_SEND,
  ScopeEnum.RUN_CANCEL,
  ScopeEnum.APPROVAL_RESOLVE,
  ScopeEnum.TERMINAL_EXEC,
] as const;

export const CUSTOM_WEBHOOK_SCOPES = [
  ScopeEnum.PROJECT_READ,
  ScopeEnum.PROJECT_WRITE,
  ScopeEnum.PROMPT_SEND,
  ScopeEnum.RUN_CANCEL,
  ScopeEnum.APPROVAL_RESOLVE,
  ScopeEnum.GIT_WRITE,
  ScopeEnum.TERMINAL_EXEC,
] as const;
