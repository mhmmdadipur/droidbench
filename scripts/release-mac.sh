#!/usr/bin/env bash
# Build the SIGNED macOS release locally and attach it to the same GitHub
# Release that CI builds Windows/Linux into — so one release has every platform
# AND the updater works on macOS too.
#
# Prereq (once): you have the updater private key at
#   ~/.droidbench-keys/droidbench.key
#
# Flow:
#   1) bump version in src-tauri/tauri.conf.json
#   2) bash scripts/release-mac.sh        -> signed .dmg + .app.tar.gz + .sig
#   3) git tag vX.Y.Z && git push origin vX.Y.Z
#        -> CI builds Windows+Linux, creates the release, writes latest.json
#   4) upload the macOS .dmg AND .app.tar.gz(.sig) to that release
#   5) merge the macOS entry into latest.json (see scripts/merge-latest-json.md)
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.droidbench-keys/droidbench.key}"
if [ ! -f "$KEY" ]; then
  echo "ERROR: updater private key not found at $KEY"
  echo "Generate once with: npm run tauri signer generate -- -w $KEY --password ''"
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

echo "==> Fetching bundled binaries for macOS"
bash scripts/fetch-binaries.sh mac

echo "==> Building + signing macOS bundle"
npm run tauri build

BUNDLE="src-tauri/target/release/bundle"
echo
echo "macOS artifacts:"
ls -1 "$BUNDLE/dmg/"*.dmg 2>/dev/null || true
ls -1 "$BUNDLE/macos/"*.app.tar.gz 2>/dev/null || true
ls -1 "$BUNDLE/macos/"*.app.tar.gz.sig 2>/dev/null || true
echo
echo "Next:"
echo "  gh release upload <tag> $BUNDLE/dmg/*.dmg $BUNDLE/macos/*.app.tar.gz $BUNDLE/macos/*.app.tar.gz.sig"
echo "  then merge the macOS entry into latest.json (see scripts/merge-latest-json.md)"
