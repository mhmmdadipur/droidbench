import { useState } from "react";
import { Usb, Zap, RefreshCw, ExternalLink, Lightbulb } from "lucide-react";
import { Button } from "../ui/Button";
import { TabHelp } from "../ui/Section";
import { Step, StepList, type StepState, type StatusTone } from "../ui/Stepper";
import { RomListButton } from "../ui/RomList";
import { RecoveryFlashBlock, RomInstallBlock } from "../flash/CustomRomBlocks";
import { BrandNav } from "../flash/BrandNav";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useFlashing } from "../../state/flashing";
import { useI18n } from "../../i18n";

async function openUrl(url: string) {
  try {
    const { openUrl: o } = await import("@tauri-apps/plugin-opener");
    await o(url);
  } catch {
    /* ignore */
  }
}

/**
 * Custom ROM → another custom ROM (or a ROM update). The bootloader is normally
 * already unlocked here; a short per-brand unlock tutorial is included for
 * anyone arriving from another brand. Coming from STOCK Xiaomi? The Xiaomi tab
 * covers stock → official/custom ROM end to end.
 */
export function CustomRomTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { lock, refreshLock, openStep, setOpenStep, goToTab } = useFlashing();
  const { t: tr } = useI18n();
  const [checkingLock, setCheckingLock] = useState(false);

  const openIdx = openStep.customrom ?? 1;
  const toggle = (i: number) => setOpenStep("customrom", i);

  const inFastboot = device.connected && device.mode === "fastboot";
  const inAdb = device.connected && device.mode === "adb";

  async function recheckLock() {
    if (!inFastboot && !inAdb) {
      push(tr("flash.needDevice"), "stderr");
      return;
    }
    setCheckingLock(true);
    push(tr("flash.checkingLock"), "system");
    try {
      const s = await refreshLock();
      push(
        s === "unlocked" ? tr("flash.lockUnlocked") : s === "locked" ? tr("flash.lockLocked") : tr("flash.lockUnknown"),
        s === "unlocked" ? "system" : "stderr",
      );
    } finally {
      setCheckingLock(false);
    }
  }

  const connTone: StatusTone = device.connected ? "ok" : "bad";
  const connLabel = device.connected ? device.mode.toUpperCase() : tr("flash.badge.noDevice");
  const unlockState: StepState = lock === "unlocked" ? "done" : lock === "locked" ? "warn" : "todo";
  const unlockTone: StatusTone = lock === "unlocked" ? "ok" : lock === "locked" ? "bad" : "neutral";
  const unlockLabel =
    lock === "unlocked" ? tr("flash.badge.unlocked") : lock === "locked" ? tr("flash.badge.locked") : tr("flash.badge.unknown");

  return (
    <>
      <TabHelp>{tr("crom.help")}</TabHelp>

      <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
        <Lightbulb size={14} className="shrink-0" />
        <span>{tr("crom.warn")}</span>
      </div>

      <StepList>
        {/* STEP 1 — connect */}
        <Step index={1} title={tr("flash.step.connect")} state={device.connected ? "done" : "active"} open={openIdx === 1} onToggle={() => toggle(1)} statusTone={connTone} statusLabel={connLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("crom.s1.desc")}</p>
          <Button size="block" title={tr("xi.s1.listHint")} onClick={() => t.fastboot(["devices"])}>
            <Usb size={14} /> {tr("xi.s1.list")}
          </Button>
          <Button size="block" disabled={!inAdb} title={tr("xi.s1.rebootFbHint")} onClick={() => t.adb(["reboot", "bootloader"])}>
            <Zap size={14} /> {tr("xi.s1.rebootFb")}
          </Button>
        </Step>

        {/* STEP 2 — bootloader status + unlock tutorial for other brands */}
        <Step index={2} title={tr("root.step.unlock")} state={unlockState} open={openIdx === 2} onToggle={() => toggle(2)} statusTone={unlockTone} statusLabel={unlockLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("crom.s2.desc")}</p>
          <Button size="block" disabled={(!inFastboot && !inAdb) || checkingLock} onClick={recheckLock}>
            <RefreshCw size={14} className={checkingLock ? "animate-spin" : ""} /> {tr("flash.checkLock")}
          </Button>

          <div className="mt-1 text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("crom.unlock.title")}</div>
          <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("crom.unlock.intro")}</p>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            <div className="mb-0.5 font-semibold text-[var(--color-ink)]">{tr("crom.unlock.xiaomi")}</div>
            {tr("crom.unlock.xiaomiBody")}
          </div>
          <Button size="block" onClick={() => goToTab("xiaomi")}>
            {tr("crom.unlock.openXiaomi")}
          </Button>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            <div className="mb-0.5 font-semibold text-[var(--color-ink)]">{tr("crom.unlock.samsung")}</div>
            {tr("crom.unlock.samsungBody")}
          </div>

          <Button size="block" onClick={() => goToTab("samsung")}>
            {tr("crom.unlock.openSamsung")}
          </Button>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            <div className="mb-0.5 font-semibold text-[var(--color-ink)]">{tr("crom.unlock.other")}</div>
            {tr("crom.unlock.otherBody")}
          </div>
          <BrandNav />

          <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-rose-700">{tr("crom.unlock.warn")}</p>
        </Step>

        {/* STEP 3 — pick the new ROM + (re)flash recovery */}
        <Step index={3} title={tr("crom.step.recovery")} state="todo" open={openIdx === 3} onToggle={() => toggle(3)}>
          <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("crom.s3.alreadyHave")}</p>
          <RecoveryFlashBlock showRomList />
        </Step>

        {/* STEP 4 — install the ROM ZIP from recovery */}
        <Step index={4} title={tr("crom.step.install")} state="todo" open={openIdx === 4} onToggle={() => toggle(4)}>
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[10.5px] leading-snug text-sky-800">
            {tr("crom.s4.cleanVsDirty")}
          </div>
          <RomInstallBlock />
        </Step>

        {/* STEP 5 — first boot */}
        <Step index={5} title={tr("crom.step.boot")} state="todo" open={openIdx === 5} onToggle={() => toggle(5)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("crom.s5.desc")}</p>
          <ul className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
            <li>• {tr("crom.s5.li1")}</li>
            <li>• {tr("crom.s5.li2")}</li>
          </ul>
          <Button size="sm" className="w-full" onClick={() => openUrl("https://wiki.lineageos.org/")}>
            <ExternalLink size={13} /> {tr("crom.s5.guide")}
          </Button>
          <RomListButton label={tr("rom.openList")} />
        </Step>
      </StepList>
    </>
  );
}
