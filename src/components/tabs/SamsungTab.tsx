import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";

// Heimdall partition names commonly mapped to Odin slots.
const SLOTS = [
  { key: "BL", partition: "BOOTLOADER", desc: "Bootloader (file BL_...tar.md5 dari firmware Samsung)" },
  { key: "AP", partition: "AP", desc: "Sistem utama / Android (file AP_...tar.md5 — paling besar)" },
  { key: "CP", partition: "MODEM", desc: "Modem / sinyal (file CP_...tar.md5)" },
  { key: "CSC", partition: "CSC", desc: "CSC — region & operator, MENGHAPUS data (file CSC_...tar.md5)" },
  { key: "HOME", partition: "HOME_CSC", desc: "HOME_CSC — seperti CSC tapi TANPA menghapus data" },
  { key: "PIT", partition: "PIT", desc: "Peta partisi (.pit) — hanya untuk re-partition, jarang dipakai" },
];

export function SamsungTab() {
  const t = useTools();
  const { push } = useLog();
  const [files, setFiles] = useState<Record<string, string>>({});
  const [noReboot, setNoReboot] = useState(false);
  const [repartition, setRepartition] = useState(false);

  async function pick(slot: string) {
    const f = await open({
      multiple: false,
      filters: [{ name: "Firmware", extensions: ["tar", "md5", "pit", "img", "bin", "lz4"] }],
    });
    if (typeof f === "string") setFiles((p) => ({ ...p, [slot]: f }));
  }
  function clearSlot(slot: string) {
    setFiles((p) => {
      const n = { ...p };
      delete n[slot];
      return n;
    });
  }

  function flash() {
    const args: string[] = ["flash"];
    for (const s of SLOTS) {
      const f = files[s.key];
      if (!f) continue;
      if (s.key === "PIT") args.push("--pit", f);
      else args.push(`--${s.partition}`, f);
    }
    if (args.length === 1) {
      push("Assign at least one slot file before flashing.", "stderr");
      return;
    }
    if (repartition) args.push("--repartition");
    if (noReboot) args.push("--no-reboot");
    t.heimdall(args);
  }

  return (
    <>
      <TabHelp>
        Khusus HP <b>Samsung</b>, pengganti Odin. HP harus di mode
        <b> Download</b> (matikan HP → tahan Volume Bawah + Power / colok USB).
        Isi slot dengan file firmware (BL/AP/CP/CSC) lalu Flash.
      </TabHelp>

      <Section title="Deteksi & Mode Download">
        <Row cols={3}>
          <Button title="Cek apakah HP Samsung di mode Download sudah terdeteksi." onClick={() => t.heimdall(["detect"])}>
            Deteksi HP
          </Button>
          <Button title="Tampilkan peta partisi (PIT) HP — info teknis." onClick={() => t.heimdall(["print-pit"])}>
            Lihat PIT
          </Button>
          <Button title="Keluar dari mode Download & nyalakan ulang HP." onClick={() => t.heimdall(["close-pc-screen"])}>
            Reboot
          </Button>
        </Row>
      </Section>

      <Section title="Slot Firmware (file .tar / .md5)">
        {SLOTS.map((s) => (
          <div key={s.key} className="flex items-center gap-2" title={s.desc}>
            <span className="w-11 text-xs font-semibold text-[var(--color-brand-600)]">
              {s.key}
            </span>
            <span
              className="flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink-soft)]"
              title={files[s.key] ?? s.desc}
            >
              {files[s.key] ? files[s.key].split("/").pop() : "— belum ada file —"}
            </span>
            <Button size="sm" title={`Pilih file untuk ${s.key}: ${s.desc}`} onClick={() => pick(s.key)}>
              …
            </Button>
            <Button size="sm" variant="info" title={`Kosongkan slot ${s.key}`} onClick={() => clearSlot(s.key)}>
              <X size={13} />
            </Button>
          </div>
        ))}
      </Section>

      <Section title="Opsi & Flash">
        <Button
          size="block"
          variant={noReboot ? "primary" : "default"}
          title="Jika ON, HP TIDAK restart otomatis setelah flash (berguna untuk flash bertahap)."
          onClick={() => setNoReboot((v) => !v)}
        >
          Tanpa reboot otomatis: {noReboot ? "ON" : "OFF"}
        </Button>
        <Button
          size="block"
          variant={repartition ? "primary" : "default"}
          title="Jika ON, HP akan di-repartition memakai file PIT. HANYA jika kamu paham — salah pakai bisa brick."
          onClick={() => setRepartition((v) => !v)}
        >
          Repartition (pakai PIT): {repartition ? "ON" : "OFF"}
        </Button>
        <Button
          size="block"
          variant="info"
          title="Mulai flash semua slot yang sudah diisi ke HP Samsung via Heimdall."
          onClick={flash}
        >
          Mulai Flash (Heimdall)
        </Button>
      </Section>
    </>
  );
}
