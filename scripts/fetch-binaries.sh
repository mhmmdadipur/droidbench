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

# --------------------------------------------------------------------------
# 3) libimobiledevice (iOS tools) — bundle on Windows; system install elsewhere
# --------------------------------------------------------------------------
# On Windows we bundle a prebuilt libimobiledevice-win64 (idevice*.exe + DLLs)
# into binaries/ so resolve_tool finds them with no extra setup. On mac/Linux
# these dynamically-linked tools are resolved from the system (Homebrew/apt),
# because bundling their shared libs portably is impractical.
if [ "$PLATFORM" = "win" ]; then
  # imobiledevice-net ships a self-contained win-x64 build with all DLLs.
  IMD_URL="https://github.com/libimobiledevice-win32/imobiledevice-net/releases/latest/download/libimobiledevice.1.2.1-r1122-win-x64.zip"
  echo "==> Downloading libimobiledevice (win-x64) for iOS support"
  IMD_DEST="$DEST/imd"
  mkdir -p "$IMD_DEST"
  if curl -fL -A "$UA" -o "$TMP/imd.zip" "$IMD_URL"; then
    mkdir -p "$TMP/imd"
    unzip -o -q "$TMP/imd.zip" -d "$TMP/imd"
    # copy the idevice*.exe tools we use + every DLL they need into binaries/imd/
    for exe in idevice_id ideviceinfo idevicediagnostics idevicescreenshot; do
      f="$(find "$TMP/imd" -name "$exe.exe" | head -1)"
      [ -n "$f" ] && cp "$f" "$IMD_DEST/" && echo "    + $exe.exe"
    done
    find "$TMP/imd" -name "*.dll" -exec cp {} "$IMD_DEST/" \; 2>/dev/null || true
    echo "==> iOS tools + DLLs copied to binaries/imd/."
  else
    echo "!!  Could not download libimobiledevice win-x64 automatically."
    echo "    Drop idevice_id.exe / ideviceinfo.exe / idevicediagnostics.exe /"
    echo "    idevicescreenshot.exe + their DLLs into $IMD_DEST manually."
    echo "    Source: https://github.com/libimobiledevice-win32/imobiledevice-net/releases"
  fi
  echo
  echo "NOTE: Windows iOS support also needs Apple Mobile Device Support (install"
  echo "      iTunes, or the Apple Devices app) for the USB driver."
else
  echo
  echo "iOS tools (idevice_id / ideviceinfo / idevicediagnostics / idevicescreenshot)"
  case "$PLATFORM" in
    mac)
      echo "will be BUNDLED (plug-and-play) by copying them + their dylibs into"
      echo "binaries/ with install-name rewrites. Requires libimobiledevice present"
      echo "at bundle time (brew install libimobiledevice), then run:"
      echo "  bash scripts/bundle-imobiledevice-mac.sh"
      if command -v idevice_id >/dev/null 2>&1 || [ -e /opt/homebrew/bin/idevice_id ]; then
        echo "==> libimobiledevice found — bundling now"
        bash "$(dirname "$0")/bundle-imobiledevice-mac.sh" || echo "!!  bundling failed; see output above"
      else
        echo "!!  libimobiledevice not installed — skipping iOS bundling."
        echo "    Install it (brew install libimobiledevice) then re-run this or"
        echo "    scripts/bundle-imobiledevice-mac.sh."
      fi
      ;;
    linux)
      echo "are resolved from the system on Linux — install libimobiledevice:"
      echo "  sudo apt install libimobiledevice-utils  (or your distro's package)"
      ;;
  esac
fi

echo
echo "Optional extras — drop into $DEST if you need them:"
echo "  - heimdall        (Samsung download-mode flashing)"
echo "  - payload-dumper  (OTA payload.bin extraction; from payload-dumper-go)"
