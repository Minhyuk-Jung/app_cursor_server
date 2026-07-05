import { describe, expect, it } from "vitest";
import {
  assertProductionSandboxPolicy,
  assertSharedRuntimeEnvPolicy,
  resolveSandboxMode,
  validateSandboxModeEnv,
} from "./config.js";

describe("resolveSandboxMode (16 / R-01)", () => {
  it("respects explicit SANDBOX_MODE", () => {
    expect(
      resolveSandboxMode({ SANDBOX_MODE: "docker" }, true),
    ).toBe("docker");
    expect(
      resolveSandboxMode({ SANDBOX_MODE: "subprocess" }, true),
    ).toBe("subprocess");
  });

  it("defaults production to docker when Docker available", () => {
    expect(
      resolveSandboxMode({ NODE_ENV: "production" }, true),
    ).toBe("docker");
  });

  it("falls back to subprocess in production without Docker", () => {
    expect(
      resolveSandboxMode({ NODE_ENV: "production" }, false),
    ).toBe("subprocess");
  });

  it("defaults development to subprocess", () => {
    expect(resolveSandboxMode({}, true)).toBe("subprocess");
  });
});

describe("validateSandboxModeEnv", () => {
  it("accepts docker and subprocess", () => {
    expect(() => validateSandboxModeEnv({ SANDBOX_MODE: "docker" })).not.toThrow();
    expect(() =>
      validateSandboxModeEnv({ SANDBOX_MODE: "subprocess" }),
    ).not.toThrow();
    expect(() => validateSandboxModeEnv({})).not.toThrow();
  });

  it("rejects invalid values", () => {
    expect(() => validateSandboxModeEnv({ SANDBOX_MODE: "docer" })).toThrow(
      /Invalid SANDBOX_MODE/,
    );
  });
});

describe("assertProductionSandboxPolicy", () => {
  it("throws for production subprocess without escape hatch", () => {
    expect(() =>
      assertProductionSandboxPolicy(
        "subprocess",
        { NODE_ENV: "production", SANDBOX_MODE: "subprocess" },
        true,
      ),
    ).toThrow(/subprocess mode is not allowed in production/);
  });

  it("allows production docker when Docker available", () => {
    expect(() =>
      assertProductionSandboxPolicy(
        "docker",
        { NODE_ENV: "production" },
        true,
      ),
    ).not.toThrow();
  });

  it("allows escape hatch ALLOW_SUBPROCESS_IN_PRODUCTION", () => {
    expect(() =>
      assertProductionSandboxPolicy("subprocess", {
        NODE_ENV: "production",
        ALLOW_SUBPROCESS_IN_PRODUCTION: "true",
      }),
    ).not.toThrow();
  });

  it("allows subprocess in development", () => {
    expect(() =>
      assertProductionSandboxPolicy("subprocess", { NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("throws when production docker missing (implicit subprocess fallback)", () => {
    expect(() =>
      assertProductionSandboxPolicy(
        "subprocess",
        { NODE_ENV: "production" },
        false,
      ),
    ).toThrow(/requires Docker/);
  });

  it("throws when production docker mode but Docker unavailable", () => {
    expect(() =>
      assertProductionSandboxPolicy(
        "docker",
        { NODE_ENV: "production", SANDBOX_MODE: "docker" },
        false,
      ),
    ).toThrow(/Docker is not available/);
  });

  it("throws for explicit production subprocess", () => {
    expect(() =>
      assertProductionSandboxPolicy(
        "subprocess",
        { NODE_ENV: "production", SANDBOX_MODE: "subprocess" },
        true,
      ),
    ).toThrow(/subprocess mode is not allowed/);
  });
});

describe("assertSharedRuntimeEnvPolicy (ADR-007 POC 3)", () => {
  it("rejects SDK_IN_CONTAINER with SANDBOX_NETWORK_INTERNAL", () => {
    expect(() =>
      assertSharedRuntimeEnvPolicy({
        SDK_IN_CONTAINER: "true",
        SANDBOX_NETWORK_INTERNAL: "true",
      }),
    ).toThrow(/incompatible with SANDBOX_NETWORK_INTERNAL/);
  });

  it("rejects SDK_IN_CONTAINER with subprocess mode", () => {
    expect(() =>
      assertSharedRuntimeEnvPolicy({
        SDK_IN_CONTAINER: "true",
        SANDBOX_MODE: "subprocess",
      }),
    ).toThrow(/requires SANDBOX_MODE=docker/);
  });

  it("allows SDK_IN_CONTAINER with docker and external egress", () => {
    expect(() =>
      assertSharedRuntimeEnvPolicy({
        SDK_IN_CONTAINER: "true",
        SANDBOX_MODE: "docker",
        SANDBOX_NETWORK_INTERNAL: "false",
      }),
    ).not.toThrow();
  });
});
