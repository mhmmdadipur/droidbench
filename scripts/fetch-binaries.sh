#!/usr/bin/env bash
# Downloads bundled CLI binaries into src-tauri/binaries so Droidbench is
# plug-and-play on a fresh laptop (no adb / fastboot / scrcpy preinstalled).
#
# Bundles: adb, fastboot (Google platform-tools) + scrcpy + scrcpy-server
#          (official portable scrcpy build; self-contained).
# Optional (manual): heimdall, payload-dumper.
#
# Usage:
#   bash scripts/fetch-binaries.sh             # current platform/arch
#   bash scripts/fetch-binaries.sh mac         # force macOS (auto arch)
#   bash scripts/fetch-binaries.sh win         # Windows x64 (for packaging on Win)
#   bash scripts/fetch-binaries.sh linux
set -euo pipefail

SCRCPY_VER="v5.0.1"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UA="Mozilla/5.0 (droidbench fetch-binaries)"

PLATFORM="${1:-auto}"
if [ "$PLATFORM" = "auto" ]; then
  case "$(uname -s)" in
    Darwin) PLATFORM="mac" ;;
    Linux)  PLATFORM="linux" ;;
    *)      PLATFORM="win" ;;
  esac
fi

ARCH="$(uname -m)"

# --------------------------------------------------------------------------
# 1) platform-tools (adb + fastboot)
# --------------------------------------------------------------------------
case "$PLATFORM" in
  mac)   PT_URL="https://dl.google.com/android/repository/platform-tools-latest-darwin.zip" ;;
  linux) PT_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip" ;;
  win)   PT_URL="https://dl.google.com/android/repository/platform-tools-latest-windows.zip" ;;
  *) echo "unknown platform $PLATFORM" >&2; exit 1 ;;
esac

echo "==> Downloading platform-tools ($PLATFORM)"
curl -fL -A "$UA" -o "$TMP/pt.zip" "$PT_URL"
unzip -o -q "$TMP/pt.zip" -d "$TMP"

echo "==> Copying adb + fastboot"
if [ "$PLATFORM" = "win" ]; then
  cp "$TMP/platform-tools/adb.exe"      "$DEST/"
  cp "$TMP/platform-tools/fastboot.exe" "$DEST/"
  cp "$TMP/platform-tools/"*.dll        "$DEST/" 2>/dev/null || true
else
  cp "$TMP/platform-tools/adb"      "$DEST/"
  cp "$TMP/platform-tools/fastboot" "$DEST/"
  chmod +x "$DEST/adb" "$DEST/fastboot"
fi

# --------------------------------------------------------------------------
# 2) scrcpy (portable, self-contained) + scrcpy-server
# --------------------------------------------------------------------------
case "$PLATFORM" in
  mac)
    if [ "$ARCH" = "x86_64" ]; then SC_ASSET="scrcpy-macos-x86_64-${SCRCPY_VER}.tar.gz"
    else SC_ASSET="scrcpy-macos-aarch64-${SCRCPY_VER}.tar.gz"; fi
    SC_KIND="tar" ;;
  linux)
    SC_ASSET="scrcpy-linux-x86_64-${SCRCPY_VER}.tar.gz"; SC_KIND="tar" ;;
  win)
    SC_ASSET="scrcpy-win64-${SCRCPY_VER}.zip"; SC_KIND="zip" ;;
esac

SC_URL="https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_VER}/${SC_ASSET}"
echo "==> Downloading scrcpy ${SCRCPY_VER} ($SC_ASSET)"
curl -fL -A "$UA" -o "$TMP/scrcpy.pkg" "$SC_URL"

mkdir -p "$TMP/scrcpy"
if [ "$SC_KIND" = "tar" ]; then
  tar xzf "$TMP/scrcpy.pkg" -C "$TMP/scrcpy" --strip-components=1
else
  unzip -o -q "$TMP/scrcpy.pkg" -d "$TMP/scrcpy"
  # win zip may nest in a folder; flatten if so
  inner="$(find "$TMP/scrcpy" -maxdepth 1 -type d -name 'scrcpy-*' | head -1)"
  [ -n "$inner" ] && mv "$inner"/* "$TMP/scrcpy/" 2>/dev/null || true
fi

echo "==> Copying scrcpy + scrcpy-server"
if [ "$PLATFORM" = "win" ]; then
  cp "$TMP/scrcpy/scrcpy.exe"     "$DEST/"
  cp "$TMP/scrcpy/scrcpy-server"  "$DEST/"
  # scrcpy win bundle also ships its own dlls (SDL2, ffmpeg) — bring them along
  cp "$TMP/scrcpy/"*.dll          "$DEST/" 2>/dev/null || true
else
  cp "$TMP/scrcpy/scrcpy"         "$DEST/"
  cp "$TMP/scrcpy/scrcpy-server"  "$DEST/"
  chmod +x "$DEST/scrcpy"
fi

echo
echo "==> Done. Binaries in $DEST"
ls -la "$DEST"
echo
echo "Bundled: adb, fastboot, scrcpy, scrcpy-server (plug-and-play)."
echo "Optional extras — drop into $DEST if you need them:"
echo "  - heimdall        (Samsung download-mode flashing)"
echo "  - payload-dumper  (OTA payload.bin extraction; from payload-dumper-go)"
