import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";

export function XiaomiTab() {
  const t = useTools();
  const { push } = useLog();
  const [fwFolder, setFwFolder] = useState<string>("");
  const [skipProduct, setSkipProduct] = useState(false);
  const [disableAntiRollback, setDisableAntiRollback] = useState(false);

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setFwFolder(dir);
      push(`Firmware folder selected: ${dir}`, "system");
    }
  }

  function executeFlash() {
    if (!fwFolder) {
      push("Select a firmware folder first.", "stderr");
      return;
    }
    // MIUI fastboot packages ship flash_all scripts. We locate one and run it.
    // Best-effort: run the shell/bat flash_all from the folder.
    const script = fwFolder + (skipProduct ? "/flash_all_except_storage" : "/flash_all");
    const ext = navigatorIsWindows() ? ".bat" : ".sh";
    push(
      `Executing flash script: ${script}${ext}` +
        (disableAntiRollback ? " (anti-rollback disabled)" : ""),
      "system",
    );
    t.raw(script + ext, [], true);
  }

  return (
    <>
      <TabHelp>
        Khusus HP <b>Xiaomi / Redmi / POCO</b>. Memasang firmware resmi (ROM)
        hasil ekstrak paket "fastboot" dari Mi (folder berisi file images +
        script flash_all). HP harus di mode Fastboot.
      </TabHelp>

      <Section title="Folder Firmware">
        <Button
          size="block"
          variant="primary"
          title="Pilih folder hasil ekstrak paket firmware Xiaomi (yang berisi script flash_all)."
          onClick={pickFolder}
        >
          Pilih Folder Firmware
        </Button>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-ink-soft)]">
          {fwFolder || "— belum ada folder dipilih —"}
        </div>
      </Section>

      <Section title="Opsi">
        <label
          className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]"
          title="Jangan hapus data pribadi (pakai script flash_all_except_storage). Aman untuk update tanpa kehilangan data."
        >
          <input
            type="checkbox"
            checked={skipProduct}
            onChange={(e) => setSkipProduct(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          Pertahankan data (jangan hapus storage)
        </label>
        <label
          className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]"
          title="Matikan proteksi anti-rollback. HATI-HATI: salah pakai bisa brick. Hanya untuk yang paham."
        >
          <input
            type="checkbox"
            checked={disableAntiRollback}
            onChange={(e) => setDisableAntiRollback(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          Matikan anti-rollback (berisiko)
        </label>
      </Section>

      <Section title="Mi Unlock">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Membuka bootloader Xiaomi butuh aplikasi resmi "Mi Unlock" + akun Mi
          yang sudah terdaftar & menunggu masa tunggu. Tidak bisa dilakukan dari
          sini — gunakan Mi Unlock resmi dari Xiaomi.
        </div>
      </Section>

      <Section>
        <Button
          size="block"
          variant="danger"
          title="Jalankan proses flashing firmware. HATI-HATI: proses ini menimpa sistem HP."
          onClick={executeFlash}
        >
          Mulai Flash Firmware
        </Button>
      </Section>
    </>
  );
}

function navigatorIsWindows() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}
