import { useState } from "react";
import { Usb, Zap, RefreshCw, ExternalLink, Lightbulb, ShieldCheck, Boxes } from "lucide-react";
import { Button } from "../ui/Button";
import { TabHelp } from "../ui/Section";
import { Step, StepList, type StepState, type StatusTone } from "../ui/Stepper";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useFlashing } from "../../state/flashing";
import { getBrand, type UnlockSupport } from "../../lib/brandGuides";
import { LinkButtons, openUrl } from "../flash/LinkButtons";
import { useI18n } from "../../i18n";

function navigatorIsWindows() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}

const SUPPORT_STYLE: Record<UnlockSupport, string> = {
  official: "border-emerald-200 bg-emerald-50 text-emerald-700",
  conditional: "border-amber-200 bg-amber-50 text-amber-700",
  none: "border-rose-200 bg-rose-50 text-rose-700",
};

/**
 * Guided flow for ONE brand (every brand other than Samsung and Xiaomi gets its
 * own tab, matching the Xiaomi and Samsung tabs). The per-brand content lives in
 * lib/brandGuides.ts; the bootloader status shown in step 2 is read from the
 * connected phone, not from that data.
 */
export function BrandTab({ brandId }: { brandId: string }) {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { lock, refreshLock, openStep, setOpenStep, goToTab } = useFlashing();
  const { t: tr, lang } = useI18n();
  const [checkingLock, setCheckingLock] = useState(false);

  const brand = getBrand(brandId);
  const stepKey = `brand-${brand.id}`;
  const openIdx = openStep[stepKey] ?? 1;
  const toggle = (i: number) => setOpenStep(stepKey, i);

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
      <TabHelp>{tr("brands.help", { brand: brand.name })}</TabHelp>

      <StepList>
        {/* STEP 1 — connect */}
        <Step index={1} title={tr("flash.step.connect")} state={device.connected ? "done" : "active"} open={openIdx === 1} onToggle={() => toggle(1)} statusTone={connTone} statusLabel={connLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("brands.s1.desc")}</p>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            <div className="mb-0.5 font-semibold text-[var(--color-ink)]">{tr("brands.s1.enter")}</div>
            {brand.enterFastboot ? brand.enterFastboot[lang] : tr("brands.s1.enterDefault")}
          </div>
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

        {/* STEP 2 — unlock bootloader (brand specific) */}
        <Step index={2} title={tr("xi.step.unlock")} state={unlockState} open={openIdx === 2} onToggle={() => toggle(2)} statusTone={unlockTone} statusLabel={unlockLabel}>
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold leading-snug ${SUPPORT_STYLE[brand.unlockSupport]}`}>
            <ShieldCheck size={14} className="shrink-0" />
            <span>{tr(`brands.support.${brand.unlockSupport}` as const)}</span>
          </div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{brand.unlock[lang]}</p>
          <LinkButtons links={brand.unlockLinks} />
          <Button size="block" disabled={(!inFastboot && !inAdb) || checkingLock} onClick={recheckLock}>
            <RefreshCw size={14} className={checkingLock ? "animate-spin" : ""} /> {tr("flash.checkLock")}
          </Button>
          {brand.unlockSupport !== "none" && (
            <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-rose-700">{tr("xi.s2.warn")}</p>
          )}
        </Step>

        {/* STEP 3 — official firmware */}
        <Step index={3} title={tr("brands.step.firmware")} state="todo" open={openIdx === 3} onToggle={() => toggle(3)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{brand.firmware[lang]}</p>
          <LinkButtons links={brand.firmwareLinks} />
          {brand.unlockSupport !== "none" && (
            <>
              <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("brands.s3.custom")}</p>
              <Button size="block" variant="violet" onClick={() => goToTab("customrom")}>
                <Boxes size={14} /> {tr("brands.toCustomRom")}
              </Button>
            </>
          )}
        </Step>

        {/* STEP 4 — flash */}
        <Step index={4} title={tr("brands.step.flash")} state="todo" open={openIdx === 4} onToggle={() => toggle(4)}>
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            <Lightbulb size={14} className="shrink-0" />
            <span>{tr("brands.s4.note")}</span>
          </div>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{brand.flash[lang]}</p>
          <LinkButtons links={brand.flashLinks} />
          {brand.unlockSupport !== "none" && (
            <Button size="block" onClick={() => goToTab("fastboot")}>
              <Zap size={14} /> {tr("brands.openFastboot")}
            </Button>
          )}
        </Step>

        {/* STEP 5 — after */}
        <Step index={5} title={tr("brands.step.after")} state="todo" open={openIdx === 5} onToggle={() => toggle(5)}>
          {brand.after && <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{brand.after[lang]}</p>}
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("xi.s5.desc")}</p>
          <Button size="block" disabled={!inFastboot} onClick={() => t.fastboot(["reboot"])}>
            <Zap size={14} /> {tr("xi.s5.reboot")}
          </Button>
          {brand.unlockSupport !== "none" && (
            <Button size="block" onClick={() => goToTab("root")}>
              <ShieldCheck size={14} /> {tr("brands.toRoot")}
            </Button>
          )}
        </Step>
      </StepList>
    </>
  );
}
