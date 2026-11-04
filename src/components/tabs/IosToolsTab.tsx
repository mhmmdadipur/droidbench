import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArchiveRestore,
  ScrollText,
  Bug,
  Boxes,
  RefreshCw,
  Trash2,
  Download,
  Square,
  Apple,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { Modal } from "../ui/Modal";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useIosTools } from "../../state/iosTools";
import { useI18n } from "../../i18n";
import {
  iosBackup,
  iosRestore,
  iosSyslog,
  iosCrashReports,
  iosListApps,
  iosInstallIpa,
  iosUninstallApp,
  type IosApp,
} from "../../lib/api";

export function IosToolsTab() {
  const { t } = useI18n();
  const { push, track, cancel, running } = useLog();
  const { device } = useDevice();
  const { apps, setApps } = useIosTools();
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<IosApp | null>(null);

  const isIos = device.connected && device.mode === "ios";

  function guard(): boolean {
    if (!isIos) {
      push(t("iostools.needs"), "stderr");
      return false;
    }
    return true;
  }

  async function pickFolder(title: string): Promise<string | null> {
    const dir = await open({ directory: true, multiple: false, title });
    return typeof dir === "string" ? dir : null;
  }

  async function doBackup() {
    if (!guard()) return;
    const dir = await pickFolder(t("iostools.backup.pick"));
    if (!dir) return;
    push(t("iostools.backup.start", { dir }), "system");
    try {
      const id = await iosBackup(device.serial, dir);
      track(id);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function doRestore() {
    if (!guard()) return;
    const dir = await pickFolder(t("iostools.restore.pick"));
    if (!dir) return;
    setConfirmRestore(dir);
  }

  async function confirmDoRestore() {
    const dir = confirmRestore;
    setConfirmRestore(null);
    if (!dir) return;
    push(t("iostools.restore.start", { dir }), "system");
    try {
      const id = await iosRestore(device.serial, dir, true);
      track(id);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function doSyslog() {
    if (!guard()) return;
    push(t("iostools.log.start"), "system");
    try {
      const id = await iosSyslog(device.serial);
      track(id);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function doCrashReports() {
    if (!guard()) return;
    const dir = await pickFolder(t("iostools.crash.pick"));
    if (!dir) return;
    push(t("iostools.crash.start", { dir }), "system");
    try {
      const id = await iosCrashReports(device.serial, dir);
      track(id);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function scanApps() {
    if (!guard()) return;
    setBusy(true);
    push(t("iostools.apps.scanning"), "system");
    try {
      const list = await iosListApps(device.serial);
      setApps(list);
      push(t("iostools.apps.scanDone", { n: list.length }), "system");
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setBusy(false);
    }
  }

  async function installIpa() {
    if (!guard()) return;
    const file = await open({
      multiple: false,
      title: t("iostools.apps.installPick"),
      filters: [{ name: "iOS App", extensions: ["ipa"] }],
    });
    if (typeof file !== "string") return;
    push(t("iostools.apps.installing", { file }), "system");
    try {
      const id = await iosInstallIpa(device.serial, file);
      track(id);
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function confirmDoUninstall() {
    const appItem = confirmUninstall;
    setConfirmUninstall(null);
    if (!appItem) return;
    push(t("iostools.apps.uninstalling", { name: appItem.name }), "system");
    try {
      const id = await iosUninstallApp(device.serial, appItem.bundle_id);
      track(id);
      // optimistically drop it from the list
      setApps((apps ?? []).filter((a) => a.bundle_id !== appItem.bundle_id));
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  return (
    <>
      <TabHelp>{t("iostools.help")}</TabHelp>

      {!isIos && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-ink-soft)]">
          <Apple size={15} className="mt-0.5 shrink-0 text-[var(--color-brand-600)]" />
          <span>{t("iostools.noDevice")}</span>
        </div>
      )}

      {running && (
        <Button size="block" variant="danger" className="mb-3" onClick={cancel}>
          <Square size={13} /> {t("iostools.stop")}
        </Button>
      )}

      {/* BACKUP / RESTORE */}
      <Section title={t("iostools.backup.section")}>
        <p className="rounded-md bg-[var(--color-bg)] px-2.5 py-1.5 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
          {t("iostools.backup.note")}
        </p>
        <Row>
          <Button variant="primary" disabled={!isIos || running} title={t("iostools.backup.hint")} onClick={doBackup}>
            <Archive size={14} /> {t("iostools.backup.btn")}
          </Button>
          <Button disabled={!isIos || running} title={t("iostools.restore.hint")} onClick={doRestore}>
            <ArchiveRestore size={14} /> {t("iostools.restore.btn")}
          </Button>
        </Row>
      </Section>

      {/* LOGS & CRASH REPORTS */}
      <Section title={t("iostools.log.section")}>
        <Button size="block" disabled={!isIos || running} title={t("iostools.log.hint")} onClick={doSyslog}>
          <ScrollText size={14} /> {t("iostools.log.btn")}
        </Button>
        <Button size="block" disabled={!isIos || running} title={t("iostools.crash.hint")} onClick={doCrashReports}>
          <Bug size={14} /> {t("iostools.crash.btn")}
        </Button>
      </Section>

      {/* APPS */}
      <Section title={t("iostools.apps.section")}>
        <p className="rounded-md bg-[var(--color-bg)] px-2.5 py-1.5 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
          {t("iostools.apps.note")}
        </p>
        <Row>
          <Button variant="primary" disabled={!isIos || busy} title={t("iostools.apps.scanHint")} onClick={scanApps}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {t("iostools.apps.scan")}
          </Button>
          <Button disabled={!isIos || running} title={t("iostools.apps.installHint")} onClick={installIpa}>
            <Download size={14} /> {t("iostools.apps.install")}
          </Button>
        </Row>

        {apps && apps.length === 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-ink-faint)]">
            <Boxes size={13} /> {t("iostools.apps.empty")}
          </p>
        )}

        {apps && apps.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            {apps.map((a) => (
              <div
                key={a.bundle_id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-[var(--color-ink)]">{a.name}</div>
                  <div className="truncate text-[10px] text-[var(--color-ink-faint)]">
                    {a.bundle_id}
                    {a.version ? ` · ${a.version}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={running}
                  title={t("iostools.apps.uninstallHint")}
                  onClick={() => setConfirmUninstall(a)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {confirmRestore && (
        <Modal icon={AlertTriangle} title={t("iostools.restore.confirmTitle")} onClose={() => setConfirmRestore(null)}>
          <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            {t("iostools.restore.confirmBody")}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setConfirmRestore(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirmDoRestore}>
              {t("iostools.restore.confirmOk")}
            </Button>
          </div>
        </Modal>
      )}

      {confirmUninstall && (
        <Modal icon={AlertTriangle} title={t("iostools.apps.uninstallConfirmTitle")} onClose={() => setConfirmUninstall(null)}>
          <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            {t("iostools.apps.uninstallConfirmBody", { name: confirmUninstall.name })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setConfirmUninstall(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirmDoUninstall}>
              {t("iostools.apps.uninstallConfirmOk")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
