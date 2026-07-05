#!/usr/bin/env bash
# P7 mobile 28차 — Maestro emulator CI run (GitHub Actions + local)
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../../.." && pwd)}"
APK="${MAESTRO_APK:-$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk}"
E2E_PORT="${E2E_PORT:-3000}"
API_URL="${MAESTRO_API_URL:-http://127.0.0.1:${E2E_PORT}}"

echo "Maestro emulator CI: ROOT=$ROOT APK=$APK"

if [ ! -f "$APK" ]; then
  echo "APK not found: $APK" >&2
  exit 1
fi

adb wait-for-device
adb shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 1; done' || true
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global transition_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
adb shell input keyevent 82 || true

for i in 1 2 3; do
  adb install -r "$APK" && break
  echo "adb install retry $i"
  sleep 5
done

cd "$ROOT/apps/server"
E2E_PORT="$E2E_PORT" \
DATABASE_URL="${DATABASE_URL:-file:./e2e-maestro.db}" \
WORKSPACE_ROOT="${WORKSPACE_ROOT:-./e2e-maestro-workspaces}" \
CI=1 \
npm run e2e:server &
E2E_PID=$!

cleanup() {
  if [ -n "${E2E_PID:-}" ]; then
    kill "$E2E_PID" 2>/dev/null || true
    wait "$E2E_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

for i in $(seq 1 60); do
  curl -sf "${API_URL}/health" && break
  sleep 2
done
curl -sf "${API_URL}/health"

adb reverse "tcp:${E2E_PORT}" "tcp:${E2E_PORT}"

if ! command -v maestro >/dev/null 2>&1; then
  curl -Ls "https://get.maestro.mobile.dev" | bash
  export PATH="$HOME/.maestro/bin:$PATH"
fi
maestro --version

cd "$ROOT/apps/mobile"
run_maestro() {
  MAESTRO_DEVICE_MODE=run \
  MAESTRO_USE_SUITE=1 \
  MAESTRO_APK="$APK" \
  MAESTRO_API_URL="$API_URL" \
  MAESTRO_DEBUG_OUTPUT="${MAESTRO_DEBUG_OUTPUT:-$ROOT/apps/mobile/maestro-debug}" \
  npm run test:maestro:device:ci
}

if ! run_maestro; then
  echo "Maestro run failed — retry once after 10s"
  sleep 10
  run_maestro
fi

echo "Maestro emulator CI OK"
