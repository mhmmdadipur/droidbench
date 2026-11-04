import { open } from "@tauri-apps/plugin-dialog";
import { HardDriveDownload, Boxes, Zap } from "lucide-react";
import { Button } from "../ui/Button";
import { RomListButton } from "../ui/RomList";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useFlashing } from "../../state/flashing";
import { useI18n } from "../../i18n";

/**
 * Shared "flash a custom recovery" block. Used by both the Xiaomi tab (stock →
 * custom ROM) and the Custom ROM tab (custom ROM → another custom ROM), so the
 * two flows stay identical. Flashing is only enabled on an unlocked bootloader.
 */
export function RecoveryFlashBlock({ showRomList = false }: { showRomList?: boolean }) {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { lock } = useFlashing();
  const { t: tr } = useI18n();

  const inFastboot = device.connected && device.mode === "fastboot";

  async function flashTo(partition: "recovery" | "boot") {
    if (!inFastboot) {
      push(tr("flash.needFastboot"), "stderr");
      return;
    }
    const file = await open({
      multiple: false,
      title: tr("crom.s3.pick"),
      filters: [{ name: "Recovery image", extensions: ["img"] }],
    });
    if (typeof file !== "string") return;
    push(tr("crom.s3.flashing", { file }), "system");
    t.fastboot(["flash", partition, file]);
  }

  return (
    <>
      <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("crom.s3.desc")}</p>
      {showRomList && <RomListButton label={tr("crom.s3.openList")} />}
      <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("crom.s3.flashHint")}</p>
      <Button size="block" variant="danger" disabled={lock !== "unlocked"} title={tr("crom.s3.flashRecoveryHint")} onClick={() => flashTo("recovery")}>
        <HardDriveDownload size={14} /> {tr("crom.s3.flashRecovery")}
      </Button>
      <Button size="block" disabled={lock !== "unlocked"} title={tr("crom.s3.flashBootHint")} onClick={() => flashTo("boot")}>
        <HardDriveDownload size={14} /> {tr("crom.s3.flashBoot")}
      </Button>
      {lock !== "unlocked" && <p className="text-[10.5px] leading-snug text-rose-600">{tr("xi.s4.needUnlock")}</p>}
    </>
  );
}

/**
 * Shared "install the ROM ZIP from recovery" block: the checklist plus
 * reboot-to-sideload and sideload-ZIP buttons.
 */
export function RomInstallBlock() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { t: tr } = useI18n();

  const inAdb = device.connected && device.mode === "adb";

  async function sideload() {
    const file = await open({
      multiple: false,
      title: tr("crom.s4.sideloadPick"),
      filters: [{ name: "ROM ZIP", extensions: ["zip"] }],
    });
    if (typeof file !== "string") return;
    push(tr("crom.s4.sideloading", { file }), "system");
    t.adb(["sideload", file]);
  }

  return (
    <>
      <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("crom.s4.desc")}</p>
      <ol className="flex list-none flex-col gap-1 text-[11px] text-[var(--color-ink-soft)]">
        <li>1. {tr("crom.s4.li1")}</li>
        <li>2. {tr("crom.s4.li2")}</li>
        <li>3. {tr("crom.s4.li3")}</li>
        <li>4. {tr("crom.s4.li4")}</li>
        <li>5. {tr("crom.s4.li5")}</li>
      </ol>
      <Button size="block" disabled={!inAdb} title={tr("crom.s4.sideloadHint")} onClick={() => t.adb(["reboot", "sideload"])}>
        <Zap size={14} /> {tr("crom.s4.sideloadReboot")}
      </Button>
      <Button size="block" title={tr("crom.s4.sideloadPickHint")} onClick={sideload}>
        <Boxes size={14} /> {tr("crom.s4.sideload")}
      </Button>
    </>
  );
}
