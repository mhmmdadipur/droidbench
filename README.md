# Droidbench

A fresh, native desktop toolbox for Android flashing, servicing, debloat **and
live screen mirroring** — for **macOS and Windows** from a single codebase.
Built with **Tauri 2 + React 19 + Tailwind v4**. CLI tools (adb / fastboot /
heimdall / payload-dumper / scrcpy) are **bundled**, so you can copy the app to
another laptop and just click.

## Highlights

- **macOS traffic-light window** (red / yellow / green) on both macOS and
  Windows. Light, airy UI with a teal accent and rounded window corners.
- **Device status** card with auto polling + a **Tools** bar showing whether
  each CLI is bundled / from system / missing.
- **Big searchable command log** on the right: search, errors-only filter,
  auto-scroll, cancel & clear.
- **Embedded live mirror** — mirrors the device screen *inside its own
  Droidbench window*, with an on-screen control panel. H.264 is decoded in Rust
  (OpenH264), so it does **not** depend on the WebView's codec support.

## Tabs

| Tab | What it does |
|-----|--------------|
| **ADB** | start/kill server, reboot system/recovery/fastboot/sideload, sideload ZIP, **Start Mirroring**, list devices, dump props |
| **Fastboot** | getvar, flash boot/recovery/init_boot/vendor_boot/vbmeta, temp-boot, A/B slot, dis-verity/dis-vbmeta, unlock/lock |
| **Xiaomi** | pick firmware folder, run flash_all scripts, Mi Unlock notes |
| **Samsung (Heimdall)** | detect, print-pit, BL/AP/CP/CSC/HOME/PIT slots, no-reboot/repartition, flash |
| **Dumper** | extract partition images from an A/B OTA `payload.bin` / ZIP |
| **Debloat** | Xiaomi / Universal (25 brands) / Android TV package databases, applied over ADB with reversible `pm disable-user` |

## Live mirror

Clicking **Start Mirroring** opens a separate window containing the device
screen (click/drag/scroll to control it) plus a control panel:

- **Device**: Power, Restart, Notifications, Quick Settings, Hide Panels,
  Settings, Developer Options, About Phone, Clear Recents
- **Clipboard**: PC → Phone, Phone → PC
- **Files**: Screenshot (pull to a chosen folder), Push File
- **Nav bar**: Recents / Home / Back

How it works: Droidbench acts as the scrcpy *client*. It pushes `scrcpy-server`
to the device, opens an adb reverse tunnel, and reads the raw H.264 Annex-B
stream (`send_frame_meta=false` for a clean bitstream). Each NAL unit is decoded
with **OpenH264** to RGBA in Rust and blitted to a `<canvas>`. Input events are
sent back through scrcpy's control socket.

## Prerequisites (for building)

- Node 20+ and npm
- Rust (stable) via rustup
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools + WebView2 (preinstalled on Win 11)

OpenH264 is compiled from source via `cc` / `nasm-rs`; no system codec needed.

## Setup

```bash
npm install

# generate debloat databases (committed; re-run to refresh)
bash scripts/gen-databases.sh

# fetch bundled adb/fastboot/scrcpy/scrcpy-server for your platform
bash scripts/fetch-binaries.sh            # auto-detect
bash scripts/fetch-binaries.sh win        # Windows .exe/.dll (when packaging for Windows)
```

`heimdall` and `payload-dumper` are optional — drop their executables into
`src-tauri/binaries/`. If a binary is not bundled, Droidbench resolves it from
common install locations / PATH.

## Develop / Build

```bash
npm run tauri dev                 # hot-reload dev
npm run tauri build               # .app + .dmg (macOS) / .msi + .exe (Windows)
npm run tauri build -- --bundles app   # macOS .app only (skips dmg packaging)
```

Tauri cannot cross-compile desktop apps — build the Windows installer on
Windows (run `scripts/fetch-binaries.sh win` first) and the macOS bundle on
macOS.

## Releases (hybrid: local macOS + CI Windows/Linux, one release)

To save CI minutes (the macOS runner costs 10× minutes), macOS is built locally
and Windows/Linux are built by GitHub Actions — all into **one** release:

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. On your Mac: `bash scripts/release-mac.sh` → produces the `.dmg`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` → the
   [`release.yml`](.github/workflows/release.yml) workflow builds Windows + Linux
   and creates the GitHub Release for that tag.
4. Upload the local `.dmg` to that same release (web UI, or `gh release upload vX.Y.Z <dmg>`).

The release then contains `.dmg` (mac) + `.exe`/`.msi` (windows) +
`.AppImage`/`.deb` (linux). On a **public repo**, GitHub Actions is free, and no
macOS runner is used.

## Project layout

```
src/
  App.tsx                       layout shell + mirror-window routing (?view=mirror)
  components/
    TitleBar.tsx                macOS traffic-light window controls
    DeviceStatus.tsx            device status card
    ToolsBar.tsx                bundled/system/missing tool badges
    LogPanel.tsx                searchable streaming log
    tabs/*.tsx                  ADB / Fastboot / Xiaomi / Samsung / Dumper / Debloat
    mirror/
      MirrorView.tsx            canvas + control panel (live mirror)
      MirrorTitleBar.tsx        white traffic-light title bar for the mirror window
    ui/*.tsx                    Button, Section/Row
  state/                        log / device / tools / mirror contexts
  lib/                          api.ts, mirrorApi.ts, decoder helpers, useTools
src-tauri/
  src/runner.rs                 process spawn + streaming + cancel + tool resolution
  src/device.rs                 device detection
  src/debloat.rs                load databases + list packages
  src/mirror.rs                 scrcpy-server plumbing + OpenH264 decode + frame emit
  src/control.rs                scrcpy control messages (touch/key/scroll/back)
  databases/*.json              bundled debloat package lists
  binaries/*                    bundled adb/fastboot/scrcpy/scrcpy-server
```

## Credits & licenses

Debloat package data (MIT):

- [MiDebloat-Remover](https://github.com/myruldev/MiDebloat-Remover) — myruldev
- [Android-Universal-Debloat](https://github.com/myruldev/Android-Universal-Debloat) — myruldev
- [tv-detox](https://github.com/Ansub/tv-detox) — Ansub (AI parts omitted)

Bundled tools: Android platform-tools (adb/fastboot, Google),
[scrcpy](https://github.com/Genymobile/scrcpy) (Genymobile), and
[OpenH264](https://github.com/cisco/openh264) (Cisco) via the `openh264` crate.

## Safety

Debloat uses `pm disable-user` — reversible, nothing is uninstalled. Flashing,
unlocking bootloaders, and disabling verity can brick a device or void
warranty. Use only on devices you own and understand. You are responsible for
what you flash.
