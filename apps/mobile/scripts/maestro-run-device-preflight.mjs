#!/usr/bin/env node
/**
 * P7 mobile 27차 — Maestro run_device preflight (gate + script + suite nav 검증)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = process.cwd();
const emulatorScript = join(mobileRoot, "scripts/maestro-emulator-ci.sh");

execSync("node scripts/maestro-gate.mjs", { stdio: "inherit" });
execSync("node scripts/maestro-workflow-gate.mjs", { stdio: "inherit" });
execSync("node scripts/expo-monorepo-guard.mjs", { stdio: "inherit" });

if (!existsSync(emulatorScript)) {
  throw new Error("Missing scripts/maestro-emulator-ci.sh");
}
const scriptContent = readFileSync(emulatorScript, "utf8");
for (const snippet of [
  "adb reverse",
  "e2e:server",
  "MAESTRO_USE_SUITE=1",
  "trap cleanup EXIT",
]) {
  if (!scriptContent.includes(snippet)) {
    throw new Error(`maestro-emulator-ci.sh: missing "${snippet}"`);
  }
}
for (const snippet of ["APK not found", "maestro --version"]) {
  if (!scriptContent.includes(snippet)) {
    throw new Error(`maestro-emulator-ci.sh: missing "${snippet}"`);
  }
}

const suiteNavChecks = [
  ["suite/settings-flow.yaml", "settings-back-btn"],
  ["suite/inbox-flow.yaml", "inbox-screen"],
  ["suite/usage-flow.yaml", "usage-screen"],
  ["suite/project-flow.yaml", "project-back-btn"],
  ["suite/inbox-git-flow.yaml", "project-back-btn"],
  ["suite/files-flow.yaml", "project-back-btn"],
  ["suite/git-flow.yaml", "project-back-btn"],
  ["suite/markdown-flow.yaml", "project-back-btn"],
];

for (const [file, testId] of suiteNavChecks) {
  const content = readFileSync(join(mobileRoot, ".maestro", file), "utf8");
  if (!content.includes(testId)) {
    throw new Error(`${file}: must include ${testId} for single-session nav`);
  }
}

console.log("Maestro run_device preflight OK");
