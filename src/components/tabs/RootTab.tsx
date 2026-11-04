import { open } from "@tauri-apps/plugin-dialog";
import {
  Download,
  FileDown,
  Zap,
  RefreshCw,
  ExternalLink,
  Lightbulb,
  PackageCheck,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/Button";
import { Row, TabHelp } from "../ui/Section";
import { Step, StepList, type StepState, type StatusTone } from "../ui/Stepper";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useFlashing } from "../../state/flashing";
import { runCapture } from "../../lib/api";
import { useI18n } from "../../i18n";

async function openUrl(url: string) {
  try {
    const { openUrl: o } = await import("@tauri-apps/plugin-opener");
    await o(url);
  } catch {
    /* ignore */
  }
}

export function RootTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { lock, refreshLock, openStep, setOpenStep } = useFlashing();
  const { t: tr } = useI18n();
  const [checkingLock, setCheckingLock] = useState(false);
  const [rooted, setRooted] = useState<"yes" | "no" | "unknown">("unknown");
  const [checkingRoot, setCheckingRoot] = useState(false);

  const openIdx = openStep.root ?? 1;
  const toggle = (i: number) => setOpenStep("root", i);

  const inFastboot = device.connected && device.mode === "fastboot";
  const inAdb = device.connected && device.mode === "adb";

  async function recheckLock() {
    if (!inFastboot && !inAdb) {
      push(tr("flash.needDevice"), "stderr");
      return;
    }
    setCheckingLock(true);
    try {
      const s = await refreshLock();
      push(s === "unlocked" ? tr("flash.lockUnlocked") : tr("flash.lockLocked"), s === "unlocked" ? "system" : "stderr");
    } finally {
      setCheckingLock(false);
    }
  }

  // push the stock boot.img to the phone so Magisk can patch it in-place is the
  // manual route; here we guide the standard "patch on phone" flow. We do offer
  // a flash of a user-picked patched image.
  async function flashPatchedBoot() {
    if (!inFastboot) {
      push(tr("flash.needFastboot"), "stderr");
      return;
    }
    const file = await open({
      multiple: false,
      title: tr("root.s4.pick"),
      filters: [{ name: "Patched boot image", extensions: ["img"] }],
    });
    if (typeof file !== "string") return;
    push(tr("root.s4.flashing", { file }), "system");
    // init_boot on Android 13+ GKI devices, boot on older — we flash boot by
    // default and tell the user about init_boot in the notes.
    t.fastboot(["flash", "boot", file]);
  }

  async function flashPatchedInitBoot() {
    if (!inFastboot) {
      push(tr("flash.needFastboot"), "stderr");
      return;
    }
    const file = await open({
      multiple: false,
      title: tr("root.s4.pick"),
      filters: [{ name: "Patched init_boot image", extensions: ["img"] }],
    });
    if (typeof file !== "string") return;
    push(tr("root.s4.flashing", { file }), "system");
    t.fastboot(["flash", "init_boot", file]);
  }

  async function checkRoot() {
    if (!inAdb) {
      push(tr("root.needAdb"), "stderr");
      return;
    }
    setCheckingRoot(true);
    push(tr("root.s5.checking"), "system");
    try {
      // `su -c id` returns uid=0 when rooted & granted; most non-root returns error
      const out = await runCapture("adb", ["shell", "su", "-c", "id"]);
      const ok = /uid=0/.test(out);
      setRooted(ok ? "yes" : "no");
      push(ok ? tr("root.s5.yes") : tr("root.s5.no"), ok ? "system" : "stderr");
    } catch {
      setRooted("no");
      push(tr("root.s5.no"), "stderr");
    } finally {
      setCheckingRoot(false);
    }
  }

  const unlockState: StepState = lock === "unlocked" ? "done" : lock === "locked" ? "warn" : "todo";
  const unlockTone: StatusTone = lock === "unlocked" ? "ok" : lock === "locked" ? "bad" : "neutral";
  const unlockLabel =
    lock === "unlocked"
      ? tr("flash.badge.unlocked")
      : lock === "locked"
        ? tr("flash.badge.locked")
        : tr("flash.badge.unknown");
  const rootTone: StatusTone | undefined = rooted === "yes" ? "ok" : rooted === "no" ? "neutral" : undefined;
  const rootLabel = rooted === "yes" ? tr("root.badge.rooted") : rooted === "no" ? tr("root.badge.notRooted") : undefined;

  return (
    <>
      <TabHelp>{tr("root.help")}</TabHelp>

      <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
        <Lightbulb size={14} className="shrink-0" />
        <span>{tr("root.warn")}</span>
      </div>

      <StepList>
        {/* STEP 1 — prerequisites: unlocked bootloader */}
        <Step
          index={1}
          title={tr("root.step.unlock")}
          state={unlockState}
          open={openIdx === 1}
          onToggle={() => toggle(1)}
          statusTone={unlockTone}
          statusLabel={unlockLabel}
        >
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("root.s1.desc")}</p>
          <Button size="block" disabled={(!inFastboot && !inAdb) || checkingLock} onClick={recheckLock}>
            <RefreshCw size={14} className={checkingLock ? "animate-spin" : ""} /> {tr("flash.checkLock")}
          </Button>
        </Step>

        {/* STEP 2 — get Magisk + stock boot.img */}
        <Step index={2} title={tr("root.step.get")} state="todo" open={openIdx === 2} onToggle={() => toggle(2)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("root.s2.desc")}</p>
          <Button size="block" variant="primary" onClick={() => openUrl("https://github.com/topjohnwu/Magisk/releases/latest")}>
            <Download size={14} /> {tr("root.s2.magisk")}
          </Button>
          <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("root.s2.bootHint")}</p>
          <Button size="sm" className="w-full" onClick={() => openUrl("https://topjohnwu.github.io/Magisk/install.html")}>
            <ExternalLink size={13} /> {tr("root.s2.guide")}
          </Button>
        </Step>

        {/* STEP 3 — install Magisk APK + patch boot on phone */}
        <Step index={3} title={tr("root.step.patch")} state="todo" open={openIdx === 3} onToggle={() => toggle(3)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("root.s3.desc")}</p>
          <ol className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
            <li>1. {tr("root.s3.li1")}</li>
            <li>2. {tr("root.s3.li2")}</li>
            <li>3. {tr("root.s3.li3")}</li>
            <li>4. {tr("root.s3.li4")}</li>
          </ol>
          <Button size="block" disabled={!inAdb} title={tr("root.s3.pushHint")} onClick={async () => {
            const file = await open({ multiple: false, title: tr("root.s3.pushPick"), filters: [{ name: "Image", extensions: ["img"] }] });
            if (typeof file !== "string") return;
            push(tr("root.s3.pushing"), "system");
            t.adb(["push", file, "/sdcard/Download/"]);
          }}>
            <FileDown size={14} /> {tr("root.s3.push")}
          </Button>
        </Step>

        {/* STEP 4 — flash patched boot via fastboot */}
        <Step index={4} title={tr("root.step.flash")} state="todo" open={openIdx === 4} onToggle={() => toggle(4)}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("root.s4.desc")}</p>
          <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-700">{tr("root.s4.initBootNote")}</p>
          <Row>
            <Button variant="danger" disabled={lock !== "unlocked"} title={tr("root.s4.flashBootHint")} onClick={flashPatchedBoot}>
              <Zap size={14} /> {tr("root.s4.flashBoot")}
            </Button>
            <Button variant="danger" disabled={lock !== "unlocked"} title={tr("root.s4.flashInitBootHint")} onClick={flashPatchedInitBoot}>
              <Zap size={14} /> {tr("root.s4.flashInitBoot")}
            </Button>
          </Row>
          <Button size="block" disabled={!inFastboot} onClick={() => t.fastboot(["reboot"])}>
            <Zap size={14} /> {tr("root.s4.reboot")}
          </Button>
          {lock !== "unlocked" && <p className="text-[10.5px] leading-snug text-rose-600">{tr("xi.s4.needUnlock")}</p>}
        </Step>

        {/* STEP 5 — verify root */}
        <Step index={5} title={tr("root.step.verify")} state={rooted === "yes" ? "done" : "todo"} open={openIdx === 5} onToggle={() => toggle(5)} statusTone={rootTone} statusLabel={rootLabel}>
          <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("root.s5.desc")}</p>
          <Button size="block" variant="primary" disabled={!inAdb || checkingRoot} onClick={checkRoot}>
            <PackageCheck size={14} className={checkingRoot ? "animate-pulse" : ""} /> {tr("root.s5.check")}
          </Button>
          <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("root.s5.note")}</p>
        </Step>
      </StepList>
    </>
  );
}
