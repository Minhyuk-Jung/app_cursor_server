#!/usr/bin/env node
/**
 * Monorepo Expo SDK guard — root hoisted expo must match @app/mobile (SDK 52).
 * Prevents CI Android builds from linking expo@57 (expo-module-gradle-plugin).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(scriptDir, "..");
const repoRoot = join(mobileRoot, "../..");
const requireFrom = createRequire(join(mobileRoot, "package.json"));

function readPkgVersion(pkgRoot) {
  const pkgPath = join(pkgRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function resolveExpoRoot(startDir) {
  try {
    const pkgJson = requireFrom.resolve("expo/package.json", {
      paths: [startDir],
    });
    return dirname(pkgJson);
  } catch {
    return null;
  }
}

const mobileExpoRoot = resolveExpoRoot(mobileRoot);
if (!mobileExpoRoot) {
  throw new Error("expo-monorepo-guard: cannot resolve expo from apps/mobile");
}
const mobileExpoVersion = readPkgVersion(mobileExpoRoot);

const rootExpoRoot = resolveExpoRoot(repoRoot);
const rootExpoVersion = rootExpoRoot ? readPkgVersion(rootExpoRoot) : null;

if (rootExpoRoot && rootExpoVersion !== mobileExpoVersion) {
  throw new Error(
    `expo-monorepo-guard: root expo@${rootExpoVersion} != mobile expo@${mobileExpoVersion}. ` +
      "Add expo@52 to root package.json overrides or run npm install from repo root.",
  );
}

if (rootExpoRoot) {
  const androidGradle = join(rootExpoRoot, "android/build.gradle");
  if (existsSync(androidGradle)) {
    const content = readFileSync(androidGradle, "utf8");
    if (content.includes("expo-module-gradle-plugin")) {
      throw new Error(
        "expo-monorepo-guard: root expo android/build.gradle uses expo-module-gradle-plugin (SDK 57+). " +
          "Pin root expo to SDK 52.",
      );
    }
  }
}

console.log(
  `expo-monorepo-guard OK (mobile expo@${mobileExpoVersion}` +
    `${rootExpoVersion ? `, root expo@${rootExpoVersion}` : ", no root expo"})`,
);
