#!/usr/bin/env bash
# Generates Droidbench debloat databases from the three upstream repos.
# Output: src-tauri/databases/{xiaomi,universal,tv}.json
#
# Sources (all MIT licensed):
#   - MiDebloat-Remover        (Xiaomi/MIUI/HyperOS)
#   - Android-Universal-Debloat (24+ brands)
#   - tv-detox                  (Android TV, Claude parts omitted)
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/databases"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

AUD_BASE="https://raw.githubusercontent.com/myruldev/Android-Universal-Debloat/main/database"
AUD_BRANDS=(universal samsung xiaomi oppo vivo realme oneplus motorola nokia sony asus honor huawei infinix itel lenovo lg meizu nubia pixel sharp tcl tecno wiko zte)

echo "==> Building universal.json from Android-Universal-Debloat"
node "$(dirname "$0")/gen-databases.mjs" "$OUT" "$AUD_BASE" "${AUD_BRANDS[@]}"

echo "==> Done. Databases written to $OUT"
ls -la "$OUT"
