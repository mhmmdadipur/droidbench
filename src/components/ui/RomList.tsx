import { useState } from "react";
import { ExternalLink, Boxes, HardDriveDownload } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useI18n } from "../../i18n";

async function openUrl(url: string) {
  try {
    const { openUrl: o } = await import("@tauri-apps/plugin-opener");
    await o(url);
  } catch {
    /* ignore */
  }
}

/** A recommended custom ROM / recovery with its OFFICIAL download page. */
interface RomEntry {
  name: string;
  url: string;
  note?: string;
}

/** Well-known, actively-maintained AOSP-based custom ROMs. Official sources
 * only — we never host or link mirrors. Users must pick the build matching
 * their device codename on each project's page. */
const ROMS: RomEntry[] = [
  { name: "LineageOS", url: "https://wiki.lineageos.org/devices/", note: "stock-like, widest device support" },
  { name: "Pixel Experience", url: "https://get.pixelexperience.org/", note: "Pixel UI & features" },
  { name: "Evolution X", url: "https://evolution-x.org/devices", note: "Pixel + heavy customization" },
  { name: "crDroid", url: "https://crdroid.net/downloads", note: "LineageOS + many tweaks" },
  { name: "Project Infinity-X", url: "https://sourceforge.net/projects/projectinfinity-x/files/", note: "feature-rich, lightweight" },
  { name: "RisingOS", url: "https://sourceforge.net/projects/risingos-revived/files/", note: "modern AOSP, polished" },
  { name: "Nameless AOSP", url: "https://nameless-aosp.net/", note: "clean & stable" },
  { name: "AxionAOSP", url: "https://axionaosp.github.io/", note: "performance-focused" },
];

const RECOVERIES: RomEntry[] = [
  { name: "OrangeFox", url: "https://orangefox.download/", note: "modern touch recovery" },
  { name: "TWRP", url: "https://twrp.me/Devices/", note: "classic, broad support" },
];

function LinkCard({ e }: { e: RomEntry }) {
  return (
    <button
      onClick={() => openUrl(e.url)}
      className="no-drag flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-left transition-colors hover:border-[var(--color-brand)]"
    >
      <span className="min-w-0">
        <span className="block text-[11.5px] font-semibold text-[var(--color-ink)]">{e.name}</span>
        {e.note && <span className="block truncate text-[9.5px] text-[var(--color-ink-faint)]">{e.note}</span>}
      </span>
      <ExternalLink size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
    </button>
  );
}

/** Grid of recommended custom ROMs (official pages). */
export function RomGrid() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ROMS.map((e) => (
        <LinkCard key={e.name} e={e} />
      ))}
    </div>
  );
}

/** Grid of recommended custom recoveries (OrangeFox / TWRP). */
export function RecoveryGrid() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {RECOVERIES.map((e) => (
        <LinkCard key={e.name} e={e} />
      ))}
    </div>
  );
}

/**
 * A button that opens a popup dialog listing recommended custom ROMs +
 * recoveries. Used where there isn't room for the full grid inline (the list
 * is long), e.g. inside a flashing step.
 */
export function RomListButton({ label }: { label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="block" onClick={() => setOpen(true)}>
        <Boxes size={14} /> {label ?? t("rom.openList")}
      </Button>
      {open && (
        <Modal icon={Boxes} title={t("rom.title")} onClose={() => setOpen(false)}>
          <p className="mb-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">{t("rom.intro")}</p>

          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--color-brand-600)]">
            <Boxes size={14} /> {t("rom.romsTitle")}
          </div>
          <RomGrid />

          <div className="mb-1 mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--color-brand-600)]">
            <HardDriveDownload size={14} /> {t("rom.recoveryTitle")}
          </div>
          <RecoveryGrid />

          <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-700">
            {t("rom.warn")}
          </p>
        </Modal>
      )}
    </>
  );
}
