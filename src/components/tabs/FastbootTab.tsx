import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useI18n } from "../../i18n";

export function FastbootTab() {
  const t = useTools();
  const { t: tr } = useI18n();

  async function openUrl(url: string) {
    try {
      const { openUrl: open } = await import("@tauri-apps/plugin-opener");
      await open(url);
    } catch {
      /* ignore */
    }
  }

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

      <Section title={tr("fb.guide.title")}>
        <p className="text-[11px] leading-snug text-[var(--color-ink-soft)]">{tr("fb.guide.intro")}</p>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 text-[11px] leading-snug">
          <div className="mb-1 font-semibold text-[var(--color-brand-600)]">{tr("fb.guide.ubl")}</div>
          <ul className="flex flex-col gap-1 text-[var(--color-ink-soft)]">
            <li>• {tr("fb.guide.ubl.xiaomi")}</li>
            <li>• {tr("fb.guide.ubl.samsung")}</li>
            <li>• {tr("fb.guide.ubl.pixel")}</li>
            <li>• {tr("fb.guide.ubl.generic")}</li>
          </ul>
        </div>
        <div className="mb-1 mt-1 text-[11px] font-semibold text-[var(--color-brand-600)]">{tr("fb.guide.rom")}</div>
        <p className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">{tr("fb.guide.romHint")}</p>
        <Row>
          <Button size="sm" onClick={() => openUrl("https://wiki.lineageos.org/devices/")}>
            {tr("fb.guide.lineage")}
          </Button>
          <Button size="sm" onClick={() => openUrl("https://download.pixelexperience.org/")}>
            {tr("fb.guide.pixelexp")}
          </Button>
        </Row>
        <Button size="block" onClick={() => openUrl("https://xdaforums.com/")}>
          {tr("fb.guide.xda")}
        </Button>
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-700">
          {tr("fb.guide.warn")}
        </p>
      </Section>

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
