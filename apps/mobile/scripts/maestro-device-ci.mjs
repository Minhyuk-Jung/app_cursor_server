#!/usr/bin/env node
/**
 * P7 mobile 27차 — Maestro 디바이스 E2E CI
 *
 * Modes (MAESTRO_DEVICE_MODE):
 *   scaffold (default) — flow gate + env checklist, exit 0
 *   run — MAESTRO_APK + maestro CLI + adb device
 *         default: mobile-device-suite.yaml (single session)
 *         MAESTRO_USE_SUITE=0 — run flows individually
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.MAESTRO_DEVICE_MODE ?? "scaffold";
const apkPath = process.env.MAESTRO_APK ?? "";
const apiUrl = (process.env.MAESTRO_API_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const flows = [
  ".maestro/mobile-api-setup.yaml",
  ".maestro/mobile-smoke.yaml",
  ".maestro/mobile-settings-flow.yaml",
  ".maestro/mobile-project-flow.yaml",
  ".maestro/mobile-inbox-flow.yaml",
  ".maestro/mobile-inbox-git-flow.yaml",
  ".maestro/mobile-usage-flow.yaml",
  ".maestro/mobile-files-flow.yaml",
  ".maestro/mobile-git-flow.yaml",
  ".maestro/mobile-markdown-flow.yaml",
];
const suiteFlow = ".maestro/mobile-device-suite.yaml";

function runGate() {
  execSync("node scripts/maestro-gate.mjs", { stdio: "inherit" });
}

function hasMaestroCli() {
  const r = spawnSync("maestro", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

function hasAdbDevice() {
  const r = spawnSync("adb", ["devices"], { encoding: "utf8" });
  if (r.status !== 0) return false;
  return r.stdout
    .split("\n")
    .slice(1)
    .some((line) => line.trim().endsWith("device"));
}

function sleepMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // sync wait for health polling
  }
}

function waitForApiHealth() {
  if (process.env.MAESTRO_SKIP_API_WAIT === "1") return;
  for (let i = 0; i < 45; i += 1) {
    try {
      execSync(`curl -sf "${apiUrl}/health"`, { stdio: "pipe" });
      console.log(`Maestro E2E API ready: ${apiUrl}`);
      return;
    } catch {
      sleepMs(1000);
    }
  }
  throw new Error(`API not ready at ${apiUrl}/health — start e2e server + adb reverse`);
}

function seedDemoProject() {
  if (process.env.MAESTRO_SKIP_SEED === "1") return;
  execSync("npx tsx scripts/maestro-seed-project.ts", {
    stdio: "inherit",
    env: {
      ...process.env,
      MAESTRO_API_URL: apiUrl,
    },
  });
}

function setupAdbReverse() {
  if (process.env.MAESTRO_SKIP_ADB_REVERSE === "1") return;
  const port = new URL(`${apiUrl}/`).port || "3000";
  execSync(`adb reverse tcp:${port} tcp:${port}`, { stdio: "inherit" });
  console.log(`adb reverse tcp:${port} tcp:${port}`);
}

function runDeviceFlows() {
  if (!apkPath || !existsSync(apkPath)) {
    throw new Error(
      `MAESTRO_APK must point to an existing APK (got: ${apkPath || "(empty)"})`,
    );
  }
  if (!hasMaestroCli()) {
    throw new Error("maestro CLI not found — install from https://maestro.mobile.dev");
  }
  if (!hasAdbDevice()) {
    throw new Error(
      "no adb device/emulator connected — start emulator or connect device before run mode",
    );
  }

  setupAdbReverse();
  waitForApiHealth();
  seedDemoProject();

  const smokeOnly = process.env.MAESTRO_CI_SMOKE_ONLY === "1";
  const smokeFlow = ".maestro/mobile-smoke.yaml";
  const useSuite = process.env.MAESTRO_USE_SUITE !== "0";
  const suiteAbs = join(process.cwd(), suiteFlow);
  const smokeAbs = join(process.cwd(), smokeFlow);

  if (smokeOnly) {
    console.log(`Maestro device run: ${smokeFlow} (CI smoke only)`);
    const debugFlag = process.env.MAESTRO_DEBUG_OUTPUT
      ? `--debug-output "${process.env.MAESTRO_DEBUG_OUTPUT}"`
      : "";
    execSync(
      `maestro test --app-path "${apkPath}" ${debugFlag} "${smokeAbs}"`.replace(
        /\s+/g,
        " ",
      ),
      {
        stdio: "inherit",
        env: {
          ...process.env,
          MAESTRO_APK: apkPath,
          ...(process.env.MAESTRO_DEBUG_OUTPUT
            ? { MAESTRO_DEBUG_OUTPUT: process.env.MAESTRO_DEBUG_OUTPUT }
            : {}),
        },
      },
    );
    return;
  }

  if (useSuite && existsSync(suiteAbs)) {
    console.log(`Maestro device run: ${suiteFlow} (single session)`);
    const debugFlag = process.env.MAESTRO_DEBUG_OUTPUT
      ? `--debug-output "${process.env.MAESTRO_DEBUG_OUTPUT}"`
      : "";
    execSync(
      `maestro test --app-path "${apkPath}" ${debugFlag} "${suiteAbs}"`.replace(
        /\s+/g,
        " ",
      ),
      {
      stdio: "inherit",
      env: {
        ...process.env,
        MAESTRO_APK: apkPath,
        ...(process.env.MAESTRO_DEBUG_OUTPUT
          ? { MAESTRO_DEBUG_OUTPUT: process.env.MAESTRO_DEBUG_OUTPUT }
          : {}),
      },
    });
    return;
  }

  for (const flow of flows) {
    const abs = join(process.cwd(), flow);
    console.log(`Maestro device run: ${flow} (apk=${apkPath})`);
    execSync(`maestro test --app-path "${apkPath}" "${abs}"`, {
      stdio: "inherit",
      env: {
        ...process.env,
        MAESTRO_APK: apkPath,
        ...(process.env.MAESTRO_DEBUG_OUTPUT
          ? { MAESTRO_DEBUG_OUTPUT: process.env.MAESTRO_DEBUG_OUTPUT }
          : {}),
      },
    });
  }
}

runGate();

if (mode === "run") {
  runDeviceFlows();
  console.log("Maestro device E2E OK");
} else {
  console.log(
    [
      "Maestro device CI scaffold OK",
      "- flows validated via maestro-gate (9 required flows + device suite)",
      "- run mode: MAESTRO_DEVICE_MODE=run + MAESTRO_APK (default: mobile-device-suite.yaml)",
      "- MAESTRO_CI_SMOKE_ONLY=1 — run mobile-smoke.yaml only (CI default)",
      "- MAESTRO_USE_SUITE=0 — run 9 flows individually",
      "- API: start e2e server on :3000 + adb reverse + maestro-seed-project.ts",
      "- workflow: .github/workflows/p7-mobile-maestro-e2e.yml (workflow_dispatch run_device)",
    ].join("\n"),
  );
}
