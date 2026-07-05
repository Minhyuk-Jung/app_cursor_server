import { z } from "zod";
import {
  ApprovalDecision,
  AttachmentKind,
  ChangeKind,
  ChannelSource,
  ErrorKind,
  ExecOutputChannel,
  RunTerminalStatus,
  StatusScope,
} from "./enums.js";

const uuidSchema = z.string().uuid();
const nonEmptyString = z.string().min(1);

export const attachmentSchema = z.object({
  kind: z.enum([
    AttachmentKind.IMAGE,
    AttachmentKind.FILE,
    AttachmentKind.FILE_REF,
  ]),
  ref: nonEmptyString,
  mime: z.string().optional(),
});

export const normalizedCommandBaseSchema = z.object({
  source: z.enum([
    ChannelSource.WEB,
    ChannelSource.MOBILE,
    ChannelSource.SLACK,
    ChannelSource.TEAMS,
    ChannelSource.TELEGRAM,
    ChannelSource.CUSTOM,
    ChannelSource.SYSTEM,
  ]),
  requestId: uuidSchema,
});

export const createProjectCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("create_project"),
  name: nonEmptyString,
  template: z.string().optional(),
  gitUrl: z.string().optional(),
});

export const createSessionCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("create_session"),
  projectId: nonEmptyString,
  model: z.string().optional(),
  title: z.string().optional(),
});

export const sendPromptCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("send_prompt"),
  sessionId: nonEmptyString,
  text: nonEmptyString,
  attachments: z.array(attachmentSchema).optional(),
});

export const cancelCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("cancel"),
  runId: nonEmptyString,
});

export const steerCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("steer"),
  runId: nonEmptyString,
  text: nonEmptyString,
});

export const approveCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("approve"),
  approvalId: nonEmptyString,
  decision: z.enum([ApprovalDecision.APPROVE, ApprovalDecision.REJECT]),
});

export const statusCommandSchema = normalizedCommandBaseSchema
  .extend({
    kind: z.literal("status"),
    scope: z.enum([
      StatusScope.ALL,
      StatusScope.PROJECT,
      StatusScope.SESSION,
    ]),
    id: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.scope === StatusScope.PROJECT ||
        data.scope === StatusScope.SESSION) &&
      !data.id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "id is required when scope is project or session",
        path: ["id"],
      });
    }
  });

export const execCommandSchema = normalizedCommandBaseSchema.extend({
  kind: z.literal("exec_command"),
  projectId: nonEmptyString,
  command: nonEmptyString,
  cwd: z.string().optional(),
});

export const normalizedCommandSchema = z.union([
  createProjectCommandSchema,
  createSessionCommandSchema,
  sendPromptCommandSchema,
  cancelCommandSchema,
  steerCommandSchema,
  approveCommandSchema,
  statusCommandSchema,
  execCommandSchema,
]);

export const domainEventBaseSchema = z.object({
  runId: nonEmptyString,
});

export const runStartedEventSchema = domainEventBaseSchema.extend({
  type: z.literal("run_started"),
  sessionId: nonEmptyString,
});

export const assistantEventSchema = domainEventBaseSchema.extend({
  type: z.literal("assistant"),
  text: z.string(),
});

export const toolEventSchema = domainEventBaseSchema.extend({
  type: z.literal("tool"),
  name: nonEmptyString,
  input: z.record(z.unknown()).optional(),
  /** SDK tool_call.call_id — started/completed 이벤트 상관 */
  callId: z.string().optional(),
  /** started | completed | error */
  toolStatus: z.enum(["started", "completed", "error"]).optional(),
  /** completed/error 시 툴 결과(셸 출력 등) */
  output: z.string().optional(),
  /** 13 §8.1 — AI SDK 툴 출력은 agent_tool; RunEventLog 경유 */
  outputChannel: z
    .enum([ExecOutputChannel.AGENT_TOOL, ExecOutputChannel.USER_TERMINAL])
    .optional(),
});

export const planEventSchema = domainEventBaseSchema.extend({
  type: z.literal("plan"),
  steps: z.array(z.string()),
});

export const fileChangeEventSchema = domainEventBaseSchema.extend({
  type: z.literal("file_change"),
  path: nonEmptyString,
  changeKind: z.enum([
    ChangeKind.EDIT,
    ChangeKind.CREATE,
    ChangeKind.DELETE,
  ]),
});

export const approvalRequiredEventSchema = domainEventBaseSchema.extend({
  type: z.literal("approval_required"),
  approvalId: nonEmptyString,
  detail: z.string(),
});

export const approvalResolvedEventSchema = domainEventBaseSchema.extend({
  type: z.literal("approval_resolved"),
  approvalId: nonEmptyString,
  decision: z.enum([ApprovalDecision.APPROVE, ApprovalDecision.REJECT]),
});

export const runDoneEventSchema = domainEventBaseSchema.extend({
  type: z.literal("run_done"),
  status: z.enum([
    RunTerminalStatus.FINISHED,
    RunTerminalStatus.ERROR,
    RunTerminalStatus.CANCELLED,
  ]),
});

export const errorEventSchema = z.object({
  type: z.literal("error"),
  errorKind: z.enum([ErrorKind.STARTUP, ErrorKind.RUN]),
  message: nonEmptyString,
  retryable: z.boolean().optional(),
  runId: z.string().optional(),
});

export const runQueuedEventSchema = domainEventBaseSchema.extend({
  type: z.literal("run_queued"),
  sessionId: nonEmptyString,
});

export const domainEventSchema = z.discriminatedUnion("type", [
  runQueuedEventSchema,
  runStartedEventSchema,
  assistantEventSchema,
  toolEventSchema,
  planEventSchema,
  fileChangeEventSchema,
  approvalRequiredEventSchema,
  approvalResolvedEventSchema,
  runDoneEventSchema,
  errorEventSchema,
]);

export const eventEnvelopeSchema = z.object({
  globalOffset: z.number().int().positive(),
  runId: nonEmptyString,
  seq: z.number().int().positive(),
  at: z.string().datetime(),
  event: domainEventSchema,
  projectId: nonEmptyString,
  sessionId: nonEmptyString,
});

export const appErrorSchema = z.object({
  code: nonEmptyString,
  message: nonEmptyString,
  retryable: z.boolean(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
export type NormalizedCommand = z.infer<typeof normalizedCommandSchema>;
export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type AppError = z.infer<typeof appErrorSchema>;

export function validationFailed(message: string): AppError {
  return { code: "validation_failed", message, retryable: false };
}

export function parseCommand(input: unknown): NormalizedCommand {
  return normalizedCommandSchema.parse(input);
}

export function parseDomainEvent(input: unknown): DomainEvent {
  return domainEventSchema.parse(input);
}

export function parseEventEnvelope(input: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(input);
}
