#!/usr/bin/env node
/**
 * Pre-push local gate — seconds~minutes, no GitHub required.
 * Usage: node scripts/preflight.mjs [--unit]
 */
import { execSync } from "node:child_process";

const withUnit = process.argv.includes("--unit");
const root = process.cwd();

function run(label, cmd, cwd = root) {
  console.log(`\n=== ${label} ===`);
  execSync(cmd, { stdio: "inherit", cwd });
}

run("Expo monorepo guard", "npm run test:expo:monorepo-guard -w @app/mobile");
run("Maestro run_device preflight", "npm run test:maestro:run-device:preflight -w @app/mobile");

if (withUnit) {
  run("Unit tests (@app/shared)", "npm run test -w @app/shared");
  run("Unit tests (@app/mobile)", "npm run test -w @app/mobile");
}

console.log("\nPreflight OK");
