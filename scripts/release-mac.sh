#!/usr/bin/env bash
# Build the macOS release locally and tell you how to attach it to the SAME
# GitHub Release that the Windows/Linux CI builds into.
#
# Flow for a single combined release:
#   1) bump the version in src-tauri/tauri.conf.json (e.g. 0.1.0)
#   2) run this script on your Mac            -> produces the .dmg
#   3) git tag vX.Y.Z && git push origin vX.Y.Z
#        -> GitHub Actions builds Windows + Linux and creates the release
#   4) upload the .dmg from step 2 to that release (web UI, or `gh release upload`)
#
# All artifacts (mac .dmg + win .exe/.msi + linux .AppImage/.deb) then live in
# one release.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Fetching bundled binaries for macOS"
bash scripts/fetch-binaries.sh mac

echo "==> Building macOS bundle"
npm run tauri build

DMG=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)
echo
if [ -n "$DMG" ]; then
  echo "macOS DMG ready: $DMG"
  echo
  echo "Attach it to the release created by CI:"
  echo "  • Web:  GitHub → Releases → <tag> → Edit → drag the .dmg"
  echo "  • CLI:  gh release upload <tag> \"$DMG\""
else
  echo "DMG not found (dmg packaging can fail transiently; the .app is still in"
  echo "src-tauri/target/release/bundle/macos/). Re-run, or zip the .app to upload."
fi
