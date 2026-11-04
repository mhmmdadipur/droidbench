import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Usb,
  FolderDown,
  Zap,
  RefreshCw,
  ExternalLink,
  Lightbulb,
} from "lucide-react";
import { Button } from "../ui/Button";
import { TabHelp } from "../ui/Section";
import { Step, StepList, type StepState, type StatusTone } from "../ui/Stepper";
import { RomListButton } from "../ui/RomList";
import { RecoveryFlashBlock, RomInstallBlock } from "../flash/CustomRomBlocks";
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

function navigatorIsWindows() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}

export function XiaomiTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { lock, refreshLock, xiaomiFolder, setXiaomiFolder, xiaomiTarget, setXiaomiTarget, openStep, setOpenStep } = useFlashing();
  const { t: tr } = useI18n();
  const [skipProduct, setSkipProduct] = useState(false);
  const [disableAntiRollback, setDisableAntiRollback] = useState(false);
  const [checkingLock, setCheckingLock] = useState(false);

  const openIdx = openStep.xiaomi ?? 1;
  const toggle = (i: number) => setOpenStep("xiaomi", i);

  const inFastboot = device.connected && device.mode === "fastboot";
  const inAdb = device.connected && device.mode === "adb";

  // ── Step 1: connection ──
  const connState: StepState = device.connected ? "done" : "active";
  const connTone: StatusTone = device.connected ? "ok" : "bad";
  const connLabel = device.connected ? device.mode.toUpperCase() : tr("flash.badge.noDevice");

  // ── Step 2: unlock ──
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
        s === "unlocked"
          ? tr("flash.lockUnlocked")
          : s === "locked"
            ? tr("flash.lockLocked")
            : tr("flash.lockUnknown"),
        s === "unlocked" ? "system" : "stderr",
      );
    } finally {
      setCheckingLock(false);
    }
  }
  const unlockState: StepState =
    lock === "unlocked" ? "done" : lock === "locked" ? "warn" : "todo";
  const unlockTone: StatusTone = lock === "unlocked" ? "ok" : lock === "locked" ? "bad" : "neutral";
  const unlockLabel =
    lock === "unlocked"
      ? tr("flash.badge.unlocked")
      : lock === "locked"
        ? tr("flash.badge.locked")
        : tr("flash.badge.unknown");

  // ── Step 4: flash ──
  function executeFlash() {
    if (!xiaomiFolder) {
      push(tr("xi.selectFolderFirst"), "stderr");
      return;
    }
    const script = xiaomiFolder + (skipProduct ? "/flash_all_except_storage" : "/flash_all");
    const ext = navigatorIsWindows() ? ".bat" : ".sh";
    push(
      tr("xi.executing", {
        script: script + ext,
        arb: disableAntiRollback ? tr("xi.arb") : "",
      }),
      "system",
    );
    t.raw(script + ext, [], true);
  }

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setXiaomiFolder(dir);
      push(tr("xi.folderSelected", { dir }), "system");
    }
  }

  return (
    <>
      <TabHelp>{tr("xi.help")}</TabHelp>

      <StepList>
        {/* STEP 1 — connect */}
        <Step index={1} title={tr("flash.step.connect")} state={connState} open={openIdx === 1} onToggle={() => toggle(1)} statusTone={connTone} statusLabel={connLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("xi.s1.desc")}</p>
          <ul className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
            <li>• {tr("xi.s1.li1")}</li>
            <li>• {tr("xi.s1.li2")}</li>
            <li>• {tr("xi.s1.li3")}</li>
          </ul>
          {/* Order matters: detect first, then reboot into fastboot if needed.
              Stacked vertically so the sequence reads top-to-bottom. */}
          <Button size="block" title={tr("xi.s1.listHint")} onClick={() => t.fastboot(["devices"])}>
            <Usb size={14} /> {tr("xi.s1.list")}
          </Button>
          <Button size="block" title={tr("xi.s1.rebootFbHint")} disabled={!inAdb} onClick={() => t.adb(["reboot", "bootloader"])}>
            <Zap size={14} /> {tr("xi.s1.rebootFb")}
          </Button>
          {navigatorIsWindows() && (
            <Button size="sm" className="w-full" onClick={() => openUrl("https://developer.android.com/studio/run/win-usb")}>
              <ExternalLink size={13} /> {tr("xi.s1.driver")}
            </Button>
          )}
        </Step>

        {/* STEP 2 — unlock bootloader */}
        <Step index={2} title={tr("xi.step.unlock")} state={unlockState} open={openIdx === 2} onToggle={() => toggle(2)} statusTone={unlockTone} statusLabel={unlockLabel}>
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            <Lightbulb size={14} className="shrink-0" />
            <span>{tr("xi.s2.official")}</span>
          </div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("xi.s2.desc")}</p>
          <ol className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
            <li>1. {tr("xi.s2.li1")}</li>
            <li>2. {tr("xi.s2.li2")}</li>
            <li>3. {tr("xi.s2.li3")}</li>
            <li>4. {tr("xi.s2.li4")}</li>
          </ol>
          <Button size="block" variant="primary" onClick={() => openUrl("https://en.miui.com/unlock/")}>
            <ExternalLink size={14} /> {tr("xi.s2.miUnlock")}
          </Button>
          <Button size="block" disabled={(!inFastboot && !inAdb) || checkingLock} onClick={recheckLock}>
            <RefreshCw size={14} className={checkingLock ? "animate-spin" : ""} /> {tr("flash.checkLock")}
          </Button>
          <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-rose-700">{tr("xi.s2.warn")}</p>
        </Step>

        {/* STEP 3 — choose what to install: official firmware OR a custom ROM */}
        <Step index={3} title={tr("xi.step.rom")} state={xiaomiTarget === "official" ? (xiaomiFolder ? "done" : "todo") : "todo"} open={openIdx === 3} onToggle={() => toggle(3)} statusTone={xiaomiTarget === "official" && xiaomiFolder ? "ok" : undefined} statusLabel={xiaomiTarget === "official" && xiaomiFolder ? tr("flash.badge.ready") : undefined}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("xi.s3.pathNote")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant={xiaomiTarget === "official" ? "primary" : "default"} onClick={() => setXiaomiTarget("official")}>
              {tr("xi.target.official")}
            </Button>
            <Button size="sm" variant={xiaomiTarget === "custom" ? "primary" : "default"} onClick={() => setXiaomiTarget("custom")}>
              {tr("xi.target.custom")}
            </Button>
          </div>

          {xiaomiTarget === "official" ? (
            <>
              <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("xi.s3.desc")}</p>
              <Button size="block" onClick={() => openUrl("https://xiaomifirmwareupdater.com/")}>
                <ExternalLink size={13} /> {tr("xi.s3.xfu")}
              </Button>
              <Button size="block" onClick={() => openUrl("https://xiaomirom.com/")}>
                <ExternalLink size={13} /> {tr("xi.s3.official")}
              </Button>
              <Button size="block" variant="primary" onClick={pickFolder}>
                <FolderDown size={14} /> {tr("xi.pickFolder")}
              </Button>
              <div className="break-all rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] text-[var(--color-ink-soft)]">
                {xiaomiFolder || tr("xi.noFolder")}
              </div>
            </>
          ) : (
            <>
              <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("xi.s3.customDesc")}</p>
              <RomListButton label={tr("rom.openList")} />
            </>
          )}
        </Step>

        {/* STEP 4 — flash (depends on the chosen target) */}
        <Step index={4} title={xiaomiTarget === "official" ? tr("xi.step.flash") : tr("xi.step.flashCustom")} state="todo" open={openIdx === 4} onToggle={() => toggle(4)}>
          {xiaomiTarget === "official" ? (
            <>
              <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("xi.s4.desc")}</p>
              <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]" title={tr("xi.keepDataHint")}>
                <input type="checkbox" checked={skipProduct} onChange={(e) => setSkipProduct(e.target.checked)} className="accent-[var(--color-brand)]" />
                {tr("xi.keepData")}
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]" title={tr("xi.disableArbHint")}>
                <input type="checkbox" checked={disableAntiRollback} onChange={(e) => setDisableAntiRollback(e.target.checked)} className="accent-[var(--color-brand)]" />
                {tr("xi.disableArb")}
              </label>
              <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-700">{tr("xi.s4.arbWarn")}</p>
              <Button size="block" variant="danger" disabled={lock !== "unlocked" || !xiaomiFolder} title={tr("xi.flashHint")} onClick={executeFlash}>
                <Zap size={14} /> {tr("xi.flash")}
              </Button>
              {lock !== "unlocked" && (
                <p className="text-[10.5px] leading-snug text-rose-600">{tr("xi.s4.needUnlock")}</p>
              )}
            </>
          ) : (
            <>
              <div className="mb-1 text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("xi.s4.customRecovery")}</div>
              <RecoveryFlashBlock />
              <div className="mb-1 mt-2 text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("xi.s4.customInstall")}</div>
              <RomInstallBlock />
            </>
          )}
        </Step>

        {/* STEP 5 — verify / next */}
        <Step index={5} title={tr("xi.step.verify")} state="todo" open={openIdx === 5} onToggle={() => toggle(5)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("xi.s5.desc")}</p>
          <ul className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
            <li>• {tr("xi.s5.li1")}</li>
            <li>• {tr("xi.s5.li2")}</li>
          </ul>
          <Button size="block" disabled={!inFastboot} onClick={() => t.fastboot(["reboot"])}>
            <Zap size={14} /> {tr("xi.s5.reboot")}
          </Button>
        </Step>
      </StepList>
    </>
  );
}
