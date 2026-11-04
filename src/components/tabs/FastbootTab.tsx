import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Usb, Zap, RefreshCw, ExternalLink, Boxes, Lightbulb } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { Step, StepList, type StepState, type StatusTone } from "../ui/Stepper";
import { RomListButton } from "../ui/RomList";
import { BrandNav } from "../flash/BrandNav";
import { LinkButtons } from "../flash/LinkButtons";
import { GENERIC_GUIDE } from "../../lib/brandGuides";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useFlashing } from "../../state/flashing";
import { useI18n } from "../../i18n";

function navigatorIsWindows() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}

export function FastbootTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { lock, refreshLock, openStep, setOpenStep, goToTab } = useFlashing();
  const { t: tr, lang } = useI18n();
  const [checkingLock, setCheckingLock] = useState(false);

  const openIdx = openStep.fastboot ?? 1;
  const toggle = (i: number) => setOpenStep("fastboot", i);
  const inFastboot = device.connected && device.mode === "fastboot";
  const inAdb = device.connected && device.mode === "adb";

  async function openUrl(url: string) {
    try {
      const { openUrl: open } = await import("@tauri-apps/plugin-opener");
      await open(url);
    } catch {
      /* ignore */
    }
  }

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

  async function flash(partition: string) {
    const file = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["img", "bin"] }],
    });
    if (typeof file === "string") {
      t.fastboot(["flash", partition, file]);
    }
  }

  async function bootTemp() {
    const file = await open({
      multiple: false,
      filters: [{ name: "Boot image", extensions: ["img"] }],
    });
    if (typeof file === "string") {
      t.fastboot(["boot", file]);
    }
  }

  return (
    <>
      <TabHelp>{tr("fb.help")}</TabHelp>

      <StepList>
        {/* STEP 1 — connect */}
        <Step index={1} title={tr("flash.step.connect")} state={inFastboot ? "done" : device.connected ? "active" : "todo"} open={openIdx === 1} onToggle={() => toggle(1)} statusTone={connTone} statusLabel={connLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("fb.s1.desc")}</p>
          <Button size="block" title={tr("xi.s1.listHint")} onClick={() => t.fastboot(["devices"])}>
            <Usb size={14} /> {tr("xi.s1.list")}
          </Button>
          <Button size="block" disabled={!inAdb} title={tr("xi.s1.rebootFbHint")} onClick={() => t.adb(["reboot", "bootloader"])}>
            <Zap size={14} /> {tr("xi.s1.rebootFb")}
          </Button>
          {navigatorIsWindows() && (
            <Button size="sm" className="w-full" onClick={() => openUrl("https://developer.android.com/studio/run/win-usb")}>
              <ExternalLink size={13} /> {tr("xi.s1.driver")}
            </Button>
          )}
        </Step>

        {/* STEP 2 — bootloader status + where to unlock */}
        <Step index={2} title={tr("fb.step.status")} state={unlockState} open={openIdx === 2} onToggle={() => toggle(2)} statusTone={unlockTone} statusLabel={unlockLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("fb.s2.desc")}</p>
          <Button size="block" disabled={(!inFastboot && !inAdb) || checkingLock} onClick={recheckLock}>
            <RefreshCw size={14} className={checkingLock ? "animate-spin" : ""} /> {tr("flash.checkLock")}
          </Button>
          <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("fb.s2.where")}</p>
          <BrandNav includeMain />
        </Step>

        {/* STEP 3 — what to download */}
        <Step index={3} title={tr("fb.step.download")} state="todo" open={openIdx === 3} onToggle={() => toggle(3)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("fb.s3.desc")}</p>
          <ul className="flex list-none flex-col gap-1.5 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            <li>• {tr("fb.dl.platform")}</li>
            <li>• {tr("fb.dl.driver")}</li>
            <li>• {tr("fb.dl.rom")}</li>
            <li>• {tr("fb.dl.recovery")}</li>
            <li>• {tr("fb.dl.boot")}</li>
            <li>• {tr("fb.dl.vbmeta")}</li>
          </ul>
          <RomListButton label={tr("rom.openList")} />
          <Button size="block" onClick={() => openUrl("https://github.com/topjohnwu/Magisk/releases/latest")}>
            <ExternalLink size={13} /> {tr("fb.dl.magisk")}
          </Button>
          <Button size="block" onClick={() => goToTab("customrom")}>
            <Boxes size={14} /> {tr("fb.s3.toCustom")}
          </Button>
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            <Lightbulb size={14} className="shrink-0" />
            <span>{tr("fb.guide.warn")}</span>
          </div>
        </Step>

        {/* STEP 4 — any brand without its own tab (Tecno, Infinix, Lenovo, …) */}
        <Step index={4} title={tr("fb.step.other")} state="todo" open={openIdx === 4} onToggle={() => toggle(4)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("fb.s4.desc")}</p>

          <div className="text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("xi.step.unlock")}</div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{GENERIC_GUIDE.unlock[lang]}</p>
          <LinkButtons links={GENERIC_GUIDE.unlockLinks} />
          <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-rose-700">{tr("xi.s2.warn")}</p>

          <div className="mt-1 text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("brands.step.firmware")}</div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{GENERIC_GUIDE.firmware[lang]}</p>

          <div className="mt-1 text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("brands.step.flash")}</div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{GENERIC_GUIDE.flash[lang]}</p>
        </Step>
      </StepList>

      <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-600)]">
        {tr("fb.toolsTitle")}
      </div>

      <Section title={tr("fb.rebootInfo")}>
        <Row>
          <Button title={tr("fb.rebootNormalHint")} onClick={() => t.fastboot(["reboot"])}>
            {tr("fb.rebootNormal")}
          </Button>
          <Button title={tr("fb.toRecoveryHint")} onClick={() => t.fastboot(["reboot", "recovery"])}>
            {tr("fb.toRecovery")}
          </Button>
        </Row>
        <Row>
          <Button title={tr("fb.checkBlHint")} onClick={() => t.fastboot(["getvar", "unlocked"])}>
            {tr("fb.checkBl")}
          </Button>
          <Button title={tr("fb.modelHint")} onClick={() => t.fastboot(["getvar", "product"])}>
            {tr("fb.model")}
          </Button>
        </Row>
        <Button size="block" title={tr("fb.getvarAllHint")} onClick={() => t.fastboot(["getvar", "all"])}>
          {tr("fb.getvarAll")}
        </Button>
      </Section>

      <Section title={tr("fb.flashSec")}>
        <Row>
          <Button title={tr("fb.flashRecoveryHint")} onClick={() => flash("recovery")}>
            {tr("fb.flashRecovery")}
          </Button>
          <Button title={tr("fb.flashBootHint")} onClick={() => flash("boot")}>
            {tr("fb.flashBoot")}
          </Button>
        </Row>
        <Row>
          <Button title={tr("fb.flashInitBootHint")} onClick={() => flash("init_boot")}>
            {tr("fb.flashInitBoot")}
          </Button>
          <Button title={tr("fb.flashVendorBootHint")} onClick={() => flash("vendor_boot")}>
            {tr("fb.flashVendorBoot")}
          </Button>
        </Row>
        <Button size="block" variant="info" title={tr("fb.bootTempHint")} onClick={bootTemp}>
          {tr("fb.bootTemp")}
        </Button>
      </Section>

      <Section title={tr("fb.slotSec")}>
        <Row>
          <Button title={tr("fb.activeSlotHint")} onClick={() => t.fastboot(["getvar", "current-slot"])}>
            {tr("fb.activeSlot")}
          </Button>
          <Button title={tr("fb.switchSlotHint")} onClick={() => t.fastboot(["--set-active=other"])}>
            {tr("fb.switchSlot")}
          </Button>
        </Row>
      </Section>

      <Section title={tr("fb.veritySec")}>
        <Row>
          <Button title={tr("fb.disableVerityHint")} onClick={() => t.fastboot(["oem", "disable-verity"])}>
            {tr("fb.disableVerity")}
          </Button>
          <Button title={tr("fb.flashVbmetaHint")} onClick={() => flash("vbmeta")}>
            {tr("fb.flashVbmeta")}
          </Button>
        </Row>
        <Button
          size="block"
          title={tr("fb.disableVbmetaHint")}
          onClick={() => t.fastboot(["--disable-verity", "--disable-verification", "flash", "vbmeta"])}
        >
          {tr("fb.disableVbmeta")}
        </Button>
      </Section>

      <Section title={tr("fb.lockSec")}>
        <Row>
          <Button variant="danger" title={tr("fb.unlockHint")} onClick={() => t.fastboot(["flashing", "unlock"])}>
            {tr("fb.unlock")}
          </Button>
          <Button title={tr("fb.lockHint")} onClick={() => t.fastboot(["flashing", "lock"])}>
            {tr("fb.lock")}
          </Button>
        </Row>
        <Button size="block" title={tr("fb.oemUnlockHint")} onClick={() => t.fastboot(["oem", "unlock"])}>
          {tr("fb.oemUnlock")}
        </Button>
      </Section>
    </>
  );
}
