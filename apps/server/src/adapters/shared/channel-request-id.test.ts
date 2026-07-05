import { describe, expect, it } from "vitest";
import {
  channelRequestIdV5,
  intranetMessageRequestId,
  telegramUpdateRequestIdLogical,
} from "./channel-request-id.js";

describe("channel-request-id (01 §5.2 UUID v5)", () => {
  it("derives stable UUID v5 from logical keys", () => {
    expect(channelRequestIdV5("test:key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(channelRequestIdV5("test:key")).toBe(channelRequestIdV5("test:key"));
  });

  it("intranet and telegram namespaces differ", () => {
    expect(intranetMessageRequestId("1")).not.toBe(
      telegramUpdateRequestIdLogical(1),
    );
  });
});
