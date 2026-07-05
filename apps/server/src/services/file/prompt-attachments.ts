import { AttachmentKind } from "@app/shared";
import type { SdkPromptInput } from "../../core/sdk/sdk-adapter.js";
import type { FileService } from "./file-service.js";

export interface PromptAttachmentInput {
  kind: string;
  ref: string;
  mime?: string;
}

export function serializeAttachmentsJson(
  attachments?: PromptAttachmentInput[],
): string | null {
  if (!attachments?.length) return null;
  return JSON.stringify(attachments);
}

/** DB·채팅 UI용 본문 — 첨부 메타 줄은 attachmentsJson/UI가 담당 */
export function userMessageContent(
  text: string,
  attachments?: PromptAttachmentInput[],
): string {
  if (attachments?.length) return text.trim() || "(첨부)";
  return text;
}

export interface ResolvedPromptPayload {
  /** DB·채팅 UI용 */
  displayText: string;
  /** SdkAdapter.send (04 §6.3) */
  sdkInput: SdkPromptInput;
}

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml"];

function isTextLikeMime(mime?: string): boolean {
  if (!mime) return false;
  return TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

/** UR-15/S27 — blob ref → SDKUserMessage(images) + display text */
export async function resolvePromptWithAttachments(
  fileService: FileService,
  projectRoot: string,
  text: string,
  attachments?: PromptAttachmentInput[],
): Promise<ResolvedPromptPayload> {
  if (!attachments?.length) {
    return { displayText: text, sdkInput: text };
  }

  const images: Array<{ data: string; mimeType: string }> = [];
  const displayLines: string[] = [];

  for (const att of attachments) {
    if (att.kind === AttachmentKind.IMAGE || att.kind === "image") {
      const { data } = await fileService.readAttachment(projectRoot, att.ref);
      const mimeType = att.mime ?? "image/png";
      images.push({ data: data.toString("base64"), mimeType });
      displayLines.push(`📷 image (${mimeType}, ref ${att.ref.slice(0, 8)}…)`);
      continue;
    }

    if (att.kind === AttachmentKind.FILE || att.kind === "file") {
      const { data } = await fileService.readAttachment(projectRoot, att.ref);
      displayLines.push(
        `📎 file ref ${att.ref.slice(0, 8)}… (${data.length} bytes)`,
      );
      if (isTextLikeMime(att.mime)) {
        displayLines.push(data.toString("utf8").slice(0, 4000));
      }
      continue;
    }

    if (att.kind === AttachmentKind.FILE_REF || att.kind === "file_ref") {
      displayLines.push(`📁 file_ref: ${att.ref}`);
    }
  }

  const body = text.trim() || "(첨부)";
  const displayText =
    displayLines.length > 0
      ? `${body}\n\n${displayLines.join("\n")}`
      : body;

  if (images.length > 0) {
    return {
      displayText,
      sdkInput: {
        text: body === "(첨부)" ? "Analyze the attached image(s)." : body,
        images,
      },
    };
  }

  return { displayText, sdkInput: displayText };
}
