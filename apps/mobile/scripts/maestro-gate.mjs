#!/usr/bin/env node
/**
 * P7 mobile 14차 — Maestro CI gate (flow 검증 + 필수 assert)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const maestroDir = join(process.cwd(), ".maestro");
const requiredFlows = [
  "mobile-api-setup.yaml",
  "mobile-smoke.yaml",
  "mobile-project-flow.yaml",
  "mobile-settings-flow.yaml",
  "mobile-inbox-flow.yaml",
  "mobile-inbox-git-flow.yaml",
  "mobile-usage-flow.yaml",
  "mobile-files-flow.yaml",
  "mobile-git-flow.yaml",
  "mobile-markdown-flow.yaml",
];

function countRequiredAsserts(content) {
  const steps = content.split("\n---\n")[1] ?? content;
  const lines = steps.split("\n");
  let required = 0;
  let optionalBlock = false;
  for (const line of lines) {
    if (line.includes("optional: true")) {
      optionalBlock = true;
      continue;
    }
    if (line.startsWith("- ") && !line.includes("optional:")) {
      optionalBlock = false;
    }
    if (
      line.trim().startsWith("- assertVisible:") &&
      !optionalBlock &&
      !line.includes("optional: true")
    ) {
      required += 1;
    }
  }
  return required;
}

function validateFlowContent(name, content, { minAsserts = 1 } = {}) {
  if (!/^appId:\s*\S+/m.test(content)) {
    throw new Error(`${name}: missing appId`);
  }
  if (!content.includes("---")) {
    throw new Error(`${name}: missing Maestro steps separator (---)`);
  }
  if (!content.includes("- ")) {
    throw new Error(`${name}: no steps defined`);
  }
  const requiredAsserts = countRequiredAsserts(content);
  if (requiredAsserts < minAsserts) {
    throw new Error(
      `${name}: needs at least ${minAsserts} non-optional assertVisible`,
    );
  }
  return { content, requiredAsserts };
}

function loadFlow(name) {
  const path = join(maestroDir, name);
  const content = readFileSync(path, "utf8");
  return validateFlowContent(name, content);
}

const files = readdirSync(maestroDir).filter(
  (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
);

let totalRequiredAsserts = 0;
for (const required of requiredFlows) {
  if (!files.includes(required)) {
    throw new Error(`Missing required Maestro flow: ${required}`);
  }
  const { requiredAsserts } = loadFlow(required);
  totalRequiredAsserts += requiredAsserts;
}

if (totalRequiredAsserts < 10) {
  throw new Error(
    `Maestro gate: expected >= 10 required assertVisible steps, got ${totalRequiredAsserts}`,
  );
}

const suiteName = "mobile-device-suite.yaml";
const suiteSubflows = [
  "suite/smoke.yaml",
  "suite/settings-flow.yaml",
  "suite/project-flow.yaml",
  "suite/inbox-flow.yaml",
  "suite/inbox-git-flow.yaml",
  "suite/usage-flow.yaml",
  "suite/files-flow.yaml",
  "suite/git-flow.yaml",
  "suite/markdown-flow.yaml",
];

if (!files.includes(suiteName)) {
  throw new Error(`Missing Maestro device suite: ${suiteName}`);
}
const suiteContent = readFileSync(join(maestroDir, suiteName), "utf8");
if (!suiteContent.includes("- runFlow:")) {
  throw new Error(`${suiteName}: must define runFlow steps`);
}
  function validateMaestroYaml(name, content) {
  for (const line of content.split("\n")) {
    if (/^\s*- extendedWaitUntil:\s+\S/.test(line)) {
      throw new Error(
        `${name}: extendedWaitUntil must use multiline block (YAML formatting)`,
      );
    }
  }
}

for (const sub of suiteSubflows) {
  const subPath = join(maestroDir, sub);
  if (!existsSync(subPath)) {
    throw new Error(`Missing suite subflow: ${sub}`);
  }
  const subContent = readFileSync(subPath, "utf8");
  validateMaestroYaml(sub, subContent);
  if (subContent.includes("- launchApp")) {
    throw new Error(`${sub}: suite subflows must not launchApp (single session)`);
  }
  validateFlowContent(sub, subContent);
}
const settingsSuite = readFileSync(
  join(maestroDir, "suite/settings-flow.yaml"),
  "utf8",
);
if (
  !settingsSuite.includes("settings-back-btn") ||
  !settingsSuite.includes("settings-open-btn")
) {
  throw new Error("suite/settings-flow.yaml: must open settings and navigate back");
}
if (!suiteContent.includes("suite/usage-flow.yaml")) {
  throw new Error(`${suiteName}: must include suite/usage-flow.yaml`);
}

const apiSetup = readFileSync(join(maestroDir, "mobile-api-setup.yaml"), "utf8");
if (!apiSetup.includes("extendedWaitUntil")) {
  throw new Error("mobile-api-setup.yaml: must wait for home-tab-projects (auto-connect)");
}

console.log(
  `Maestro CI gate OK (${files.length} flow file(s), ${totalRequiredAsserts} required asserts, ${suiteSubflows.length} suite subflows)`,
);
