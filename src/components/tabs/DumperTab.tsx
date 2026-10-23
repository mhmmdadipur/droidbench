import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";

export function DumperTab() {
  const t = useTools();
  const { push } = useLog();

  async function dumpPayload() {
    const zip = await open({
      multiple: false,
      filters: [{ name: "OTA ZIP / payload", extensions: ["zip", "bin"] }],
    });
    if (typeof zip !== "string") return;
    const out = await open({ directory: true, multiple: false, title: "Output folder" });
    if (typeof out !== "string") {
      push("Select an output folder.", "stderr");
      return;
    }
    // payload-dumper-go style: payload-dumper -o <out> <payload-or-zip>
    t.payloadDumper(["-o", out, zip]);
  }

  async function extractZip() {
    const zip = await open({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (typeof zip !== "string") return;
    const out = await open({ directory: true, multiple: false, title: "Output folder" });
    if (typeof out !== "string") {
      push("Select an output folder.", "stderr");
      return;
    }
    // use system unzip (available on mac/linux; on windows we ship a fallback)
    t.raw("unzip", ["-o", zip, "-d", out], true);
  }

  return (
    <>
      <TabHelp>
        Mengambil file sistem (boot, vendor, system, dll) dari dalam file update
        <b> OTA</b> (payload.bin di dalam ZIP). Hasilnya bisa kamu flash satu per
        satu di tab Fastboot. Semua diproses di komputer, HP tidak perlu dicolok.
      </TabHelp>

      <Section title="Ekstrak Payload">
        <Button
          size="block"
          variant="success"
          title="Pilih file OTA (.zip) atau payload.bin, lalu ekstrak semua image sistem ke folder pilihanmu."
          onClick={dumpPayload}
        >
          Ekstrak payload.bin / OTA ZIP
        </Button>
        <Button
          size="block"
          title="Hanya membuka isi file ZIP biasa ke sebuah folder (tanpa memproses payload)."
          onClick={extractZip}
        >
          Ekstrak isi ZIP saja
        </Button>
      </Section>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-[var(--color-ink-soft)]">
        Contoh hasil: boot.img, vendor.img, system.img — lalu pasang masing-masing
        di tab <b>Fastboot</b>.
      </div>
    </>
  );
}
