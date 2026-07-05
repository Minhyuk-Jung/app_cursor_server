#!/usr/bin/env node
/**
 * P7 mobile 27차 — Maestro device workflow gate (p7-mobile-maestro-e2e.yml + emulator script)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = process.cwd();
const workflowPath = join(mobileRoot, "../../.github/workflows/p7-mobile-maestro-e2e.yml");
const emulatorScript = join(mobileRoot, "scripts/maestro-emulator-ci.sh");

const workflowSnippets = [
  "EXPO_PUBLIC_MAESTRO_E2E",
  "maestro-android-build.mjs",
  "MAESTRO_ANDROID_BUILD_APK",
  "android-emulator-runner",
  "Enable KVM",
  "maestro-emulator-ci.sh",
  "disable-animations: false",
  "emulator-boot-timeout: 900",
  "test:maestro:run-device:preflight",
  "pull_request:",
  "concurrency:",
  "timeout-minutes: 120",
  "Cache Gradle",
  "maestro-debug",
  "needs: maestro-scaffold",
];

const emulatorSnippets = [
  "adb reverse",
  "e2e:server",
  "MAESTRO_USE_SUITE=1",
  "/health",
  "trap cleanup EXIT",
  "maestro --version",
  "APK not found",
  "Maestro run failed — retry once",
];

let workflowContent;
try {
  workflowContent = readFileSync(workflowPath, "utf8");
} catch {
  throw new Error(`Missing workflow: ${workflowPath}`);
}

for (const snippet of workflowSnippets) {
  if (!workflowContent.includes(snippet)) {
    throw new Error(
      `p7-mobile-maestro-e2e.yml: missing required snippet "${snippet}"`,
    );
  }
}

if (!existsSync(emulatorScript)) {
  throw new Error("Missing scripts/maestro-emulator-ci.sh");
}
const scriptContent = readFileSync(emulatorScript, "utf8");
for (const snippet of emulatorSnippets) {
  if (!scriptContent.includes(snippet)) {
    throw new Error(`maestro-emulator-ci.sh: missing required snippet "${snippet}"`);
  }
}

console.log("Maestro workflow gate OK");
