#!/usr/bin/env bash
# Restores everything scripts/clean.sh --all removes, so a fresh or cleaned checkout can
# run `npm run tauri dev` again:
#
#   1) npm ci                                  -> node_modules (exact versions from the lockfile)
#   2) scripts/fetch-binaries.sh               -> adb, fastboot, scrcpy, scrcpy-server
#   3) scripts/bundle-imobiledevice-mac.sh     -> src-tauri/binaries/imd (macOS only)
#
# Needs internet. On macOS the iOS tools come from Homebrew:
#   brew install libimobiledevice ideviceinstaller
#
#   bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3 npm ci"
npm ci

echo "==> 2/3 platform tools"
bash scripts/fetch-binaries.sh

if [ "$(uname -s)" = "Darwin" ]; then
  echo "==> 3/3 iOS tools (libimobiledevice)"
  if ! command -v idevice_id >/dev/null 2>&1 && [ ! -e /opt/homebrew/bin/idevice_id ] && [ ! -e /usr/local/bin/idevice_id ]; then
    echo "ERROR: libimobiledevice is not installed. Run: brew install libimobiledevice ideviceinstaller" >&2
    exit 1
  fi
  bash scripts/bundle-imobiledevice-mac.sh
else
  echo "==> 3/3 skipped (the iOS tool bundle is built on macOS only)"
  # tauri-build needs the folder to hold at least one file
  mkdir -p src-tauri/binaries/imd
  [ -n "$(ls -A src-tauri/binaries/imd 2>/dev/null)" ] || touch src-tauri/binaries/imd/.gitkeep
fi

echo "==> Done. Start the app with: npm run tauri dev"
