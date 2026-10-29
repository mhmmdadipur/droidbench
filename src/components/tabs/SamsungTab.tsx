import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useI18n, type TKey } from "../../i18n";

// Heimdall partition names commonly mapped to Odin slots.
const SLOTS: { key: string; partition: string; descKey: TKey }[] = [
  { key: "BL", partition: "BOOTLOADER", descKey: "sa.slot.BL" },
  { key: "AP", partition: "AP", descKey: "sa.slot.AP" },
  { key: "CP", partition: "MODEM", descKey: "sa.slot.CP" },
  { key: "CSC", partition: "CSC", descKey: "sa.slot.CSC" },
  { key: "HOME", partition: "HOME_CSC", descKey: "sa.slot.HOME" },
  { key: "PIT", partition: "PIT", descKey: "sa.slot.PIT" },
];

export function SamsungTab() {
  const t = useTools();
  const { push } = useLog();
  const { t: tr } = useI18n();
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
      push(tr("sa.assignFirst"), "stderr");
      return;
    }
    if (repartition) args.push("--repartition");
    if (noReboot) args.push("--no-reboot");
    t.heimdall(args);
  }

  return (
    <>
      <TabHelp>{tr("sa.help")}</TabHelp>

      <Section title={tr("sa.detectSec")}>
        <Row cols={3}>
          <Button title={tr("sa.detectHint")} onClick={() => t.heimdall(["detect"])}>
            {tr("sa.detect")}
          </Button>
          <Button title={tr("sa.pitHint")} onClick={() => t.heimdall(["print-pit"])}>
            {tr("sa.pit")}
          </Button>
          <Button title={tr("sa.rebootHint")} onClick={() => t.heimdall(["close-pc-screen"])}>
            {tr("sa.reboot")}
          </Button>
        </Row>
      </Section>

      <Section title={tr("sa.slotsSec")}>
        {SLOTS.map((s) => {
          const desc = tr(s.descKey);
          return (
            <div key={s.key} className="flex items-center gap-2" title={desc}>
              <span className="w-11 text-xs font-semibold text-[var(--color-brand-600)]">
                {s.key}
              </span>
              <span
                className="flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink-soft)]"
                title={files[s.key] ?? desc}
              >
                {files[s.key] ? files[s.key].split("/").pop() : tr("sa.noFile")}
              </span>
              <Button size="sm" title={tr("sa.pickFor", { slot: s.key, desc })} onClick={() => pick(s.key)}>
                …
              </Button>
              <Button size="sm" variant="info" title={tr("sa.clearSlot", { slot: s.key })} onClick={() => clearSlot(s.key)}>
                <X size={13} />
              </Button>
            </div>
          );
        })}
      </Section>

      <Section title={tr("sa.optSec")}>
        <Button
          size="block"
          variant={noReboot ? "primary" : "default"}
          title={tr("sa.noRebootHint")}
          onClick={() => setNoReboot((v) => !v)}
        >
          {tr("sa.noReboot", { state: noReboot ? tr("common.on") : tr("common.off") })}
        </Button>
        <Button
          size="block"
          variant={repartition ? "primary" : "default"}
          title={tr("sa.repartitionHint")}
          onClick={() => setRepartition((v) => !v)}
        >
          {tr("sa.repartition", { state: repartition ? tr("common.on") : tr("common.off") })}
        </Button>
        <Button size="block" variant="info" title={tr("sa.flashHint")} onClick={flash}>
          {tr("sa.flash")}
        </Button>
      </Section>
    </>
  );
}
