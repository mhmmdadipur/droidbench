# Alur Kerja Droidbench (Development & Release)

Ini adalah alur kerja yang disepakati dengan pemilik repo. Patuhi di setiap sesi.

## Prinsip Utama

- **Pemilik yang pegang kendali tes.** Setiap perubahan ditest dulu oleh pemilik di
  laptop lokal (macOS) sebelum di-push atau dirilis.
- **Jangan push / tag / release otomatis.** Hanya lakukan saat diminta eksplisit
  dengan kata kunci di bawah.

## Default Setelah Membuat Perubahan Kode

1. Terapkan perubahan kode.
2. Jalankan verifikasi lokal:
   - `npx tsc --noEmit` (type check)
   - `npm run build` (bundle frontend)
3. **Update versi bila perlu** di `src-tauri/tauri.conf.json` (dan `package.json`
   jika relevan) — bump sesuai dampak perubahan (fitur = minor, perbaikan = patch).
4. **BERHENTI di sini.** Serahkan ke pemilik untuk tes manual. Jangan commit/push.
   - Jika pemilik perlu build `.app` lokal untuk tes, lakukan hanya bila diminta.

## Kata Kunci Perintah

### "push"
Ketika pemilik bilang **push** (saja):
- `git add` file yang relevan (hindari `git add -A`; jangan commit binari/secret).
- Commit dengan pesan ringkas yang menjelaskan perubahan.
- `git push` ke `origin main`.
- JANGAN membuat tag atau release.

### "release"
Ketika pemilik bilang **release**, jalankan alur rilis penuh — auto build, git, tag,
build, dan push hasil mac ke release:
1. Pastikan versi di `src-tauri/tauri.conf.json` sudah dibump; kalau belum, bump dulu.
2. Commit + push perubahan ke `origin main` (jika ada yang belum).
3. Buat tag versi: `git tag vX.Y.Z && git push origin vX.Y.Z`
   - Tag ini memicu GitHub Actions (`.github/workflows/release.yml`) untuk build
     Windows + Linux dan membuat/menggabungkan ke SATU release `vX.Y.Z`.
4. Build artifact macOS secara lokal (hemat kuota runner macOS):
   - `bash scripts/release-mac.sh` (build + signing),
     signing key di `~/.droidbench-keys/droidbench.key` (passwordless).
5. Upload artifact mac ke release yang sama:
   - `.dmg`, `.app.tar.gz`, dan `.sig` via `gh release upload vX.Y.Z <files>`
6. Merge `latest.json` agar mencakup semua platform
   (incl. `aarch64-apple-darwin`) via `scripts/merge-latest-json.mjs`.
7. Semua platform tetap dalam **satu** release, bukan release terpisah.

## Catatan Teknis

- `gh` CLI: `/opt/homebrew/bin/gh`, login sebagai `mhmmdadipur`.
- Repo publik → GitHub Actions gratis.
- Perlu `. "$HOME/.cargo/env"` di tiap shell sebelum perintah Rust/Tauri.
- Build mac cepat (skip dmg yang kadang flaky): `npm run tauri build -- --bundles app`.
- Jangan ubah git config. Jangan force-push/reset --hard tanpa izin eksplisit.

## Aturan State Tab (WAJIB untuk semua tab)

Perilaku baku (bare minimum) untuk hasil scan / data yang dibaca dari HP di
tab mana pun:

- **Pindah tab → TIDAK hilang.** Tab di-render dengan switch/case di App.tsx,
  sehingga komponen tab di-unmount saat pindah. Karena itu state hasil (report,
  pengaturan terbaca, daftar, status) TIDAK boleh disimpan via `useState` lokal
  di komponen tab — angkat ke context provider di `src/state/` (pola seperti
  `device`/`log`/`tools`/`diagnostic`) dan pasang di App.tsx.
- **Device dicabut → HARUS hilang.** Provider memantau `device.connected`
  (device auto-poll tiap 5 detik). Begitu `false`, kosongkan state-nya — data
  hanya bermakna untuk HP yang sedang tercolok.

Checklist saat menambah/mengubah tab yang membaca data dari HP:
1. State hasil hidup di provider `src/state/<fitur>.tsx`, bukan di komponen tab.
2. Ada `useEffect` yang mereset state saat `device.connected === false`.
3. Provider dipasang di pohon App.tsx (di dalam DeviceProvider).
4. Verifikasi manual: scan → pindah tab (tetap) → cabut HP (hilang).

Tab yang sudah mengikuti pola ini: Diagnostik, Koneksi/DNS, Aplikasi.
