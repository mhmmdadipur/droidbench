import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Section } from "../ui/Section";
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
      <Section title="Payload Dump (PC only)">
        <Button size="block" variant="success" onClick={dumpPayload}>
          Dump payload.bin / OTA ZIP
        </Button>
        <Button size="block" onClick={extractZip}>
          Extract files from ZIP only
        </Button>
      </Section>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-[var(--color-ink-soft)]">
        Extracts partition images (boot, vendor, system, …) from an A/B OTA
        payload so you can flash them individually in the Fastboot tab.
      </div>
    </>
  );
}
