#!/usr/bin/env node
/**
 * Maestro Android build — expo prebuild + assembleDebug (CI device job).
 * Set MAESTRO_ANDROID_BUILD_APK=1 to run Gradle; otherwise guard + prebuild dry only.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = process.cwd();
const androidDir = join(mobileRoot, "android");
const buildApk = process.env.MAESTRO_ANDROID_BUILD_APK === "1";

execSync("node scripts/expo-monorepo-guard.mjs", { stdio: "inherit", cwd: mobileRoot });

if (existsSync(androidDir)) {
  rmSync(androidDir, { recursive: true, force: true });
}

console.log("Maestro Android: expo prebuild --platform android --clean");
execSync("npx expo prebuild --platform android --clean", {
  stdio: "inherit",
  cwd: mobileRoot,
  env: {
    ...process.env,
    EXPO_PUBLIC_MAESTRO_E2E: process.env.EXPO_PUBLIC_MAESTRO_E2E ?? "1",
  },
});

if (!buildApk) {
  console.log("Maestro Android prebuild OK (set MAESTRO_ANDROID_BUILD_APK=1 for Gradle)");
  process.exit(0);
}

const apkOut = join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");
const gradleCmd =
  process.platform === "win32" ? "gradlew.bat assembleDebug" : "./gradlew assembleDebug --no-daemon";

console.log("Maestro Android: assembleDebug");
execSync(gradleCmd, {
  stdio: "inherit",
  cwd: androidDir,
  env: process.env,
});

if (!existsSync(apkOut)) {
  throw new Error(`Maestro Android build: APK not found at ${apkOut}`);
}

console.log(`Maestro Android build OK: ${apkOut}`);
