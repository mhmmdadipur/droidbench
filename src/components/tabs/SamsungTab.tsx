import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X, Usb, Zap, ExternalLink, Lightbulb, ShieldCheck, Boxes } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, TabHelp } from "../ui/Section";
import { Step, StepList, type StatusTone } from "../ui/Stepper";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useFlashing } from "../../state/flashing";
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

async function openUrl(url: string) {
  try {
    const { openUrl: o } = await import("@tauri-apps/plugin-opener");
    await o(url);
  } catch {
    /* ignore */
  }
}

export function SamsungTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { samsungFiles: files, setSamsungFiles: setFiles, openStep, setOpenStep, goToTab } = useFlashing();
  const { t: tr } = useI18n();
  const [noReboot, setNoReboot] = useState(false);
  const [repartition, setRepartition] = useState(false);

  const openIdx = openStep.samsung ?? 1;
  const toggle = (i: number) => setOpenStep("samsung", i);
  const inAdb = device.connected && device.mode === "adb";
  // Samsung Download mode shows up as mode "download" in device detection.
  const inDownload = device.connected && device.mode === "download";

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

  const connTone: StatusTone = device.connected ? "ok" : "bad";
  const connLabel = device.connected ? device.mode.toUpperCase() : tr("flash.badge.noDevice");
  const filled = SLOTS.filter((s) => files[s.key]).length;

  return (
    <>
      <TabHelp>{tr("sa.help")}</TabHelp>

      <StepList>
        {/* STEP 1 — connect in Download mode */}
        <Step index={1} title={tr("flash.step.connect")} state={inDownload ? "done" : device.connected ? "active" : "todo"} open={openIdx === 1} onToggle={() => toggle(1)} statusTone={connTone} statusLabel={connLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("sa.s1.desc")}</p>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            <div className="mb-0.5 font-semibold text-[var(--color-ink)]">{tr("sa.s1.enterTitle")}</div>
            {tr("sa.s1.enter")}
          </div>
          {/* detect first, then reboot into Download mode if needed */}
          <Button size="block" title={tr("sa.detectHint")} onClick={() => t.heimdall(["detect"])}>
            <Usb size={14} /> {tr("sa.detect")}
          </Button>
          <Button size="block" disabled={!inAdb} title={tr("sa.s1.rebootDlHint")} onClick={() => t.adb(["reboot", "download"])}>
            <Zap size={14} /> {tr("sa.s1.rebootDl")}
          </Button>
          <Button size="block" title={tr("sa.pitHint")} onClick={() => t.heimdall(["print-pit"])}>
            {tr("sa.pit")}
          </Button>
        </Step>

        {/* STEP 2 — bootloader unlock, only needed for custom ROM / root */}
        <Step index={2} title={tr("sa.step.bootloader")} state="todo" open={openIdx === 2} onToggle={() => toggle(2)}>
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            <Lightbulb size={14} className="shrink-0" />
            <span>{tr("sa.s2.when")}</span>
          </div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("sa.s2.desc")}</p>
          <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-rose-700">{tr("sa.s2.warn")}</p>
          <Button size="block" onClick={() => goToTab("customrom")}>
            <Boxes size={14} /> {tr("sa.toCustom")}
          </Button>
        </Step>

        {/* STEP 3 — get firmware */}
        <Step index={3} title={tr("sa.step.firmware")} state="todo" open={openIdx === 3} onToggle={() => toggle(3)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("sa.s3.desc")}</p>
          <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-700">{tr("sa.s3.note")}</p>
          <Button size="block" onClick={() => openUrl("https://www.samsung.com/us/support/owners/app/smart-switch")}>
            <ExternalLink size={13} /> {tr("sa.s3.smartswitch")}
          </Button>
          <Button size="block" onClick={() => openUrl("https://www.sammobile.com/firmware/")}>
            <ExternalLink size={13} /> {tr("sa.s3.sammobile")}
          </Button>
        </Step>

        {/* STEP 4 — assign files + flash */}
        <Step index={4} title={tr("sa.step.flash")} state={filled > 0 ? "active" : "todo"} open={openIdx === 4} onToggle={() => toggle(4)} statusTone={filled > 0 ? "ok" : undefined} statusLabel={filled > 0 ? tr("sa.slotsFilled", { n: filled }) : undefined}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("sa.s4.desc")}</p>
          {SLOTS.map((s) => {
            const desc = tr(s.descKey);
            return (
              <div key={s.key} className="flex items-center gap-2" title={desc}>
                <span className="w-11 text-xs font-semibold text-[var(--color-brand-600)]">{s.key}</span>
                <span
                  className="flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-ink-soft)]"
                  title={files[s.key] ?? desc}
                >
                  {files[s.key] ? files[s.key].split(/[/\\]/).pop() : tr("sa.noFile")}
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
          <Button size="block" variant="danger" disabled={filled === 0} title={tr("sa.flashHint")} onClick={flash}>
            <Zap size={14} /> {tr("sa.flash")}
          </Button>
        </Step>

        {/* STEP 5 — finish */}
        <Step index={5} title={tr("sa.step.finish")} state="todo" open={openIdx === 5} onToggle={() => toggle(5)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("sa.s5.desc")}</p>
          <ul className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
            <li>• {tr("sa.s5.li1")}</li>
            <li>• {tr("sa.s5.li2")}</li>
          </ul>
          <Row>
            <Button size="sm" onClick={() => goToTab("root")}>
              <ShieldCheck size={13} /> Root
            </Button>
            <Button size="sm" onClick={() => goToTab("customrom")}>
              <Boxes size={13} /> Custom ROM
            </Button>
          </Row>
        </Step>
      </StepList>
    </>
  );
}
