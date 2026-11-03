#!/usr/bin/env bash
# Bundle libimobiledevice CLI tools + ALL their dylibs into src-tauri/binaries/
# so Droidbench is plug-and-play on macOS (no Homebrew needed at runtime).
#
# How: copy each idevice* binary, recursively collect every non-system dylib it
# depends on, copy them next to the binaries, then rewrite every install-name /
# load path to @loader_path so the binary finds its libs beside itself.
#
# Run on macOS AFTER `brew install libimobiledevice`:
#   bash scripts/bundle-imobiledevice-mac.sh
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries/imd"
mkdir -p "$DEST"

TOOLS=(idevice_id ideviceinfo idevicediagnostics idevicescreenshot)

# locate a source binary via Homebrew/PATH
find_tool() {
  local t="$1"
  for p in "/opt/homebrew/bin/$t" "/usr/local/bin/$t" "$(command -v "$t" 2>/dev/null || true)"; do
    [ -n "$p" ] && [ -e "$p" ] && { echo "$(readlink -f "$p" 2>/dev/null || python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$p")"; return 0; }
  done
  return 1
}

is_system_lib() {
  case "$1" in
    /usr/lib/*|/System/*) return 0 ;;
    *) return 1 ;;
  esac
}

# recursively gather dylib dependencies (bash 3.2 compatible — no assoc arrays)
SEEN=" "
DEPS=()
gather() {
  local bin="$1"
  local line lib
  while IFS= read -r line; do
    lib="$(echo "$line" | awk '{print $1}')"
    [ -z "$lib" ] && continue
    case "$lib" in *.dylib) ;; *) continue ;; esac
    is_system_lib "$lib" && continue
    case "$lib" in /*) ;; *) continue ;; esac
    case "$SEEN" in *" $lib "*) continue ;; esac
    SEEN="$SEEN$lib "
    DEPS+=("$lib")
    gather "$lib"
  done < <(otool -L "$bin" 2>/dev/null | tail -n +2)
}

echo "==> Collecting tools + dylib dependencies"
SRC_BINS=()
for t in "${TOOLS[@]}"; do
  src="$(find_tool "$t" || true)"
  if [ -z "$src" ]; then
    echo "!!  $t not found — run 'brew install libimobiledevice' first." >&2
    exit 1
  fi
  SRC_BINS+=("$src")
  cp -f "$src" "$DEST/$t"
  chmod +x "$DEST/$t"
  gather "$src"
done

echo "==> Copying ${#DEPS[@]} dylibs into binaries/"
for lib in "${DEPS[@]}"; do
  cp -f "$lib" "$DEST/$(basename "$lib")"
  chmod +w "$DEST/$(basename "$lib")"
done

# Rewrite paths: for every bundled file (tools + dylibs), change each absolute
# Homebrew dependency reference to @loader_path/<basename>, and set the dylib's
# own id to @loader_path/<basename>.
echo "==> Rewriting install names to @loader_path"
rewrite() {
  local f="$1"
  # set own id for dylibs
  if [[ "$f" == *.dylib ]]; then
    install_name_tool -id "@loader_path/$(basename "$f")" "$f" 2>/dev/null || true
  fi
  local line lib base
  while IFS= read -r line; do
    lib="$(echo "$line" | awk '{print $1}')"
    case "$lib" in *.dylib) ;; *) continue ;; esac
    is_system_lib "$lib" && continue
    case "$lib" in /*) ;; *) continue ;; esac
    base="$(basename "$lib")"
    # only rewrite deps we actually bundled
    if [ -e "$DEST/$base" ]; then
      install_name_tool -change "$lib" "@loader_path/$base" "$f" 2>/dev/null || true
    fi
  done < <(otool -L "$f" 2>/dev/null | tail -n +2)
}

for t in "${TOOLS[@]}"; do rewrite "$DEST/$t"; done
for lib in "${DEPS[@]}"; do rewrite "$DEST/$(basename "$lib")"; done

# re-sign (ad-hoc) so macOS accepts the modified Mach-O files
echo "==> Ad-hoc re-signing"
for t in "${TOOLS[@]}"; do codesign -f -s - "$DEST/$t" 2>/dev/null || true; done
for lib in "${DEPS[@]}"; do codesign -f -s - "$DEST/$(basename "$lib")" 2>/dev/null || true; done

# ensure user has write permission (Homebrew libs are copied read-only, which
# otherwise makes Tauri's resource-bundling step fail with EACCES).
echo "==> Fixing permissions (u+rw)"
for t in "${TOOLS[@]}"; do chmod u+rwx "$DEST/$t" 2>/dev/null || true; done
for lib in "${DEPS[@]}"; do chmod u+rw "$DEST/$(basename "$lib")" 2>/dev/null || true; done

echo
echo "==> Done. Bundled iOS tools + dylibs in $DEST:"
ls -la "$DEST" | grep -iE "idevice|\.dylib"
echo
echo "Verify (should print a version and NOT a dyld error):"
echo "  DYLD_LIBRARY_PATH= '$DEST/ideviceinfo' -h | head -1"
