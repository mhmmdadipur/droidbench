import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";

// Heimdall partition names commonly mapped to Odin slots.
const SLOTS = [
  { key: "BL", partition: "BOOTLOADER" },
  { key: "AP", partition: "AP" },
  { key: "CP", partition: "MODEM" },
  { key: "CSC", partition: "CSC" },
  { key: "HOME", partition: "HOME_CSC" },
  { key: "PIT", partition: "PIT" },
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
      <Section title="Heimdall / Download">
        <Row cols={3}>
          <Button onClick={() => t.heimdall(["detect"])}>Detect</Button>
          <Button onClick={() => t.heimdall(["print-pit"])}>Print PIT</Button>
          <Button onClick={() => t.heimdall(["close-pc-screen"])}>Reboot</Button>
        </Row>
      </Section>

      <Section title="Odin slots (.tar / .md5)">
        {SLOTS.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="w-11 text-xs font-semibold text-[var(--color-brand-600)]">
              {s.key}
            </span>
            <span
              className="flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink-soft)]"
              title={files[s.key] ?? ""}
            >
              {files[s.key] ? files[s.key].split("/").pop() : "— no file —"}
            </span>
            <Button size="sm" onClick={() => pick(s.key)}>
              …
            </Button>
            <Button size="sm" variant="info" onClick={() => clearSlot(s.key)}>
              <X size={13} />
            </Button>
          </div>
        ))}
      </Section>

      <Section>
        <Button
          size="block"
          variant={noReboot ? "primary" : "default"}
          onClick={() => setNoReboot((v) => !v)}
        >
          No-reboot: {noReboot ? "ON" : "OFF"}
        </Button>
        <Button
          size="block"
          variant={repartition ? "primary" : "default"}
          onClick={() => setRepartition((v) => !v)}
        >
          Repartition: {repartition ? "ON" : "OFF"}
        </Button>
        <Button size="block" variant="info" onClick={flash}>
          FLASH (Heimdall)
        </Button>
      </Section>
    </>
  );
}
