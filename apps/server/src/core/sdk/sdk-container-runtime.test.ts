import { describe, expect, it } from "vitest";
import {
  containerWorkspacePath,
  verifyContainerNodeRuntime,
  verifyContainerSdkPackage,
} from "./sdk-container-runtime.js";

describe("sdk-container-runtime (ADR-007 POC)", () => {
  it("maps container workspace path", () => {
    expect(containerWorkspacePath()).toBe("/workspace");
  });

  it("rejects missing container for Node runtime", () => {
    expect(() =>
      verifyContainerNodeRuntime("cursor-sb-nonexistent-container-xyz"),
    ).toThrow(/Node.js runtime/);
  });

  it("rejects missing @cursor/sdk in container", () => {
    expect(() =>
      verifyContainerSdkPackage("cursor-sb-nonexistent-container-xyz"),
    ).toThrow(/@cursor\/sdk/);
  });
});
