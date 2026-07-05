export const ChannelSource = {
  WEB: "web",
  MOBILE: "mobile",
  SLACK: "slack",
  TEAMS: "teams",
  TELEGRAM: "telegram",
  CUSTOM: "custom",
  SYSTEM: "system",
} as const;
export type ChannelSource = (typeof ChannelSource)[keyof typeof ChannelSource];

export const ProjectStatus = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted",
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const SessionStatus = {
  IDLE: "idle",
  RUNNING: "running",
  WAITING_APPROVAL: "waiting_approval",
  ERROR: "error",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const RunStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  STREAMING: "streaming",
  WAITING_APPROVAL: "waiting_approval",
  FINISHED: "finished",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const RunTerminalStatus = {
  FINISHED: "finished",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;
export type RunTerminalStatus =
  (typeof RunTerminalStatus)[keyof typeof RunTerminalStatus];

export const Scope = {
  PROJECT_READ: "project:read",
  PROJECT_WRITE: "project:write",
  PROMPT_SEND: "prompt:send",
  RUN_CANCEL: "run:cancel",
  APPROVAL_RESOLVE: "approval:resolve",
  GIT_WRITE: "git:write",
  TERMINAL_EXEC: "terminal:exec",
} as const;
export type Scope = (typeof Scope)[keyof typeof Scope];

export const DEFAULT_MODEL = "composer-2.5";

export const SubscriptionScope = {
  SESSION: "session",
  PROJECT: "project",
  GLOBAL: "global",
} as const;
export type SubscriptionScope =
  (typeof SubscriptionScope)[keyof typeof SubscriptionScope];

export const ChangeKind = {
  EDIT: "edit",
  CREATE: "create",
  DELETE: "delete",
} as const;
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];

export const AttachmentKind = {
  IMAGE: "image",
  FILE: "file",
  FILE_REF: "file_ref",
} as const;
export type AttachmentKind =
  (typeof AttachmentKind)[keyof typeof AttachmentKind];

export const ErrorKind = {
  STARTUP: "startup",
  RUN: "run",
} as const;
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

export const ApprovalDecision = {
  APPROVE: "approve",
  REJECT: "reject",
} as const;
export type ApprovalDecision =
  (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const StatusScope = {
  ALL: "all",
  PROJECT: "project",
  SESSION: "session",
} as const;
export type StatusScope = (typeof StatusScope)[keyof typeof StatusScope];

/** 13 §8.1 — exec 출력 전달 채널 (사용자 터미널 vs AI 툴) */
export const ExecOutputChannel = {
  USER_TERMINAL: "user_terminal",
  AGENT_TOOL: "agent_tool",
} as const;
export type ExecOutputChannel =
  (typeof ExecOutputChannel)[keyof typeof ExecOutputChannel];
