import { useEffect, useState } from "react";
import {
  Smartphone,
  Zap,
  Boxes,
  PackageOpen,
  FolderOpen,
  RefreshCw,
  HelpCircle,
  Download,
  Stethoscope,
  Wifi,
  LayoutGrid,
  ScrollText,
  Wrench,
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { DeviceStatus } from "./components/DeviceStatus";
import { ToolsBar } from "./components/ToolsBar";
import { LogPanel } from "./components/LogPanel";
import { SetupWizard } from "./components/SetupWizard";
import { MirrorView } from "./components/mirror/MirrorView";
import { MirrorTitleBar } from "./components/mirror/MirrorTitleBar";
import { FileExplorer } from "./components/explorer/FileExplorer";
import { AdbTab } from "./components/tabs/AdbTab";
import { FastbootTab } from "./components/tabs/FastbootTab";
import { XiaomiTab } from "./components/tabs/XiaomiTab";
import { SamsungTab } from "./components/tabs/SamsungTab";
import { DumperTab } from "./components/tabs/DumperTab";
import { DiagnosticTab } from "./components/tabs/DiagnosticTab";
import { ConnectivityTab } from "./components/tabs/ConnectivityTab";
import { AppManagerTab } from "./components/tabs/AppManagerTab";
import { LogcatTab } from "./components/tabs/LogcatTab";
import { DeveloperTab } from "./components/tabs/DeveloperTab";
import { DeviceProvider, useDevice } from "./state/device";
import { LogProvider, useLog } from "./state/log";
import { ToolsProvider } from "./state/tools";
import { MirrorProvider } from "./state/mirror";
import { DiagnosticProvider } from "./state/diagnostic";
import { ConnectivityProvider } from "./state/connectivity";
import { AppManagerProvider } from "./state/appmanager";
import { I18nProvider, useI18n, type TKey } from "./i18n";

type TabId =
  | "adb"
  | "diagnostic"
  | "appmanager"
  | "logcat"
  | "connectivity"
  | "developer"
  | "fastboot"
  | "xiaomi"
  | "samsung"
  | "dumper";

type TabGroup = "device" | "flashing";

const TABS: { id: TabId; labelKey: TKey; icon: typeof Smartphone; descKey: TKey; group: TabGroup }[] = [
  { id: "adb", labelKey: "tab.adb", icon: Smartphone, descKey: "tab.adb.desc", group: "device" },
  { id: "diagnostic", labelKey: "tab.diagnostic", icon: Stethoscope, descKey: "tab.diagnostic.desc", group: "device" },
  { id: "appmanager", labelKey: "tab.appmanager", icon: LayoutGrid, descKey: "tab.appmanager.desc", group: "device" },
  { id: "logcat", labelKey: "tab.logcat", icon: ScrollText, descKey: "tab.logcat.desc", group: "device" },
  { id: "connectivity", labelKey: "tab.connectivity", icon: Wifi, descKey: "tab.connectivity.desc", group: "device" },
  { id: "developer", labelKey: "tab.developer", icon: Wrench, descKey: "tab.developer.desc", group: "device" },
  { id: "fastboot", labelKey: "tab.fastboot", icon: Zap, descKey: "tab.fastboot.desc", group: "flashing" },
  { id: "xiaomi", labelKey: "tab.xiaomi", icon: Boxes, descKey: "tab.xiaomi.desc", group: "flashing" },
  { id: "samsung", labelKey: "tab.samsung", icon: PackageOpen, descKey: "tab.samsung.desc", group: "flashing" },
  { id: "dumper", labelKey: "tab.dumper", icon: Download, descKey: "tab.dumper.desc", group: "flashing" },
];

const GROUPS: { id: TabGroup; labelKey: TKey; hintKey: TKey }[] = [
  { id: "device", labelKey: "nav.group.device", hintKey: "nav.group.deviceHint" },
  { id: "flashing", labelKey: "nav.group.flashing", hintKey: "nav.group.flashingHint" },
];

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "adb":
      return <AdbTab />;
    case "diagnostic":
      return <DiagnosticTab />;
    case "appmanager":
      return <AppManagerTab />;
    case "logcat":
      return <LogcatTab />;
    case "connectivity":
      return <ConnectivityTab />;
    case "developer":
      return <DeveloperTab />;
    case "fastboot":
      return <FastbootTab />;
    case "xiaomi":
      return <XiaomiTab />;
    case "samsung":
      return <SamsungTab />;
    case "dumper":
      return <DumperTab />;
  }
}

function BottomToolbar() {
  const { push, run } = useLog();
  const { t } = useI18n();

  async function openFiles() {
    push("Menampilkan isi penyimpanan HP (/sdcard)…", "system");
    run("adb", ["shell", "ls", "-la", "/sdcard"]);
  }
  function listDevices() {
    push("Mengecek HP yang terhubung…", "system");
    run("adb", ["devices", "-l"]);
  }
  function connectionHelp() {
    push("── Bantuan Koneksi HP ──", "system");
    push("1. Aktifkan 'Opsi Pengembang' di HP (Setelan > Tentang ponsel > ketuk 'Nomor bentukan' 7x).", "system");
    push("2. Aktifkan 'USB Debugging' di Opsi Pengembang.", "system");
    push("3. Colok HP ke komputer dengan kabel USB (kabel data, bukan kabel charge-only).", "system");
    push("4. Di HP akan muncul izin 'Allow USB debugging' — ketuk Izinkan/Allow.", "system");
    push("5. Klik 'Cek Perangkat' di bawah untuk memastikan HP terdeteksi.", "system");
  }
  function restartConnection() {
    push("Menyalakan ulang koneksi ADB…", "system");
    run("adb", ["kill-server"]);
    setTimeout(() => run("adb", ["start-server"]), 400);
  }

  const item = (
    label: string,
    hint: string,
    Icon: typeof Smartphone,
    onClick: () => void,
  ) => (
    <button
      onClick={onClick}
      title={hint}
      className="no-drag flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-center text-[10px] font-medium leading-tight text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
    >
      <Icon size={15} className="shrink-0" />
      <span className="w-full leading-tight">{label}</span>
    </button>
  );

  return (
    <div className="flex gap-1.5">
      {item(t("bottom.files"), t("bottom.filesHint"), FolderOpen, openFiles)}
      {item(t("bottom.check"), t("bottom.checkHint"), Smartphone, listDevices)}
      {item(t("bottom.restart"), t("bottom.restartHint"), RefreshCw, restartConnection)}
      {item(t("bottom.help"), t("bottom.helpHint"), HelpCircle, connectionHelp)}
    </div>
  );
}

function Shell() {
  const [tab, setTab] = useState<TabId>("adb");
  const [group, setGroup] = useState<TabGroup>("device");
  const { t } = useI18n();
  const { device } = useDevice();
  const activeTab = TABS.find((t) => t.id === tab);
  const groupTabs = TABS.filter((tb) => tb.group === group);
  const activeGroup = GROUPS.find((g) => g.id === group);
  // Pop the connection-guide window whenever there's no ready adb device. It
  // lives in its own window so the main UI stays fully clickable, and it closes
  // itself once a phone is ready.
  const needsSetup = !(device.connected && device.mode === "adb");
  useEffect(() => {
    if (!needsSetup) return;
    let cancelled = false;
    (async () => {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel("setup");
      if (existing || cancelled) return;
      new WebviewWindow("setup", {
        url: "index.html?view=setup",
        title: "Droidbench — Connect",
        width: 460,
        height: 640,
        resizable: true,
        decorations: false,
        shadow: true,
        transparent: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [needsSetup]);

  function switchGroup(g: TabGroup) {
    setGroup(g);
    // jump to the first tab of the newly selected group
    const first = TABS.find((tb) => tb.group === g);
    if (first) setTab(first.id);
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <TitleBar />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* COLUMN 1 — status + navigation */}
        <div className="flex w-[244px] shrink-0 flex-col gap-3">
          <DeviceStatus />
          <ToolsBar />

          {/* group switcher (segmented) */}
          <div className="flex gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-sm">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                title={t(g.hintKey)}
                onClick={() => switchGroup(g.id)}
                className={`no-drag flex-1 rounded-lg px-2 py-2 text-[12px] font-semibold transition-colors ${
                  group === g.id
                    ? "bg-[var(--color-brand)] text-white shadow-sm"
                    : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {t(g.labelKey)}
              </button>
            ))}
          </div>

          {/* vertical tab bar with label + description (filtered by group) */}
          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-sm">
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {activeGroup && t(activeGroup.labelKey)}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
              {groupTabs.map((tb) => {
                const Icon = tb.icon;
                const active = tab === tb.id;
                return (
                  <button
                    key={tb.id}
                    onClick={() => setTab(tb.id)}
                    title={t(tb.descKey)}
                    className={`no-drag flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-[var(--color-brand-50)]"
                        : "hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        active
                          ? "bg-[var(--color-brand)] text-white"
                          : "bg-[var(--color-surface-2)] text-[var(--color-ink-soft)]"
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-[13px] font-semibold leading-tight ${
                          active ? "text-[var(--color-brand-600)]" : "text-[var(--color-ink)]"
                        }`}
                      >
                        {t(tb.labelKey)}
                      </span>
                      <span className="block truncate text-[10.5px] leading-tight text-[var(--color-ink-faint)]">
                        {t(tb.descKey)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-auto">
            <BottomToolbar />
          </div>
        </div>

        {/* COLUMN 2 — active tab content (roomy, no nested scroll cramping) */}
        <div className="flex w-[330px] shrink-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
            {activeTab && <activeTab.icon size={16} className="text-[var(--color-brand-600)]" />}
            <span className="text-[13px] font-semibold text-[var(--color-ink)]">
              {activeTab && t(activeTab.labelKey)}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {needsSetup && <ConnectBanner />}
            <TabContent tab={tab} />
          </div>
        </div>

        {/* COLUMN 3 — command log / live mirror */}
        <div className="min-w-0 flex-1">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}

function RightPanel() {
  return <LogPanel />;
}

/** Small inline banner at the top of the content column when no device is
 * ready — with a button to (re)open the connection guide window. */
function ConnectBanner() {
  const { t } = useI18n();
  async function openGuide() {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel("setup");
    if (existing) {
      existing.setFocus();
      return;
    }
    new WebviewWindow("setup", {
      url: "index.html?view=setup",
      title: "Droidbench — Connect",
      width: 460,
      height: 640,
      resizable: true,
      decorations: false,
      shadow: true,
      transparent: true,
    });
  }
  return (
    <button
      onClick={openGuide}
      className="no-drag mb-3 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11.5px] leading-snug text-amber-800 transition-colors hover:bg-amber-100"
    >
      <Smartphone size={15} className="shrink-0" />
      <span className="flex-1">{t("setup.title")}</span>
      <span className="shrink-0 rounded-md bg-amber-200/70 px-2 py-0.5 text-[10px] font-semibold">
        {t("setup.openWindow")}
      </span>
    </button>
  );
}

/** Standalone page shown in the separate connection-guide window. */
function SetupPage() {
  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <div
        data-tauri-drag-region
        className="drag flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4"
      >
        <SetupTrafficLights />
        <div className="ml-2 flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--color-brand)] text-[11px] font-bold text-white">
            D
          </div>
          <Smartphone size={14} className="text-[var(--color-brand-600)]" />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
            {/* title set via i18n inside SetupWizard header area */}
            Droidbench
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <SetupWizard inWindow />
      </div>
    </div>
  );
}

function SetupTrafficLights() {
  async function close() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  }
  async function minimize() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  }
  const Light = ({ color, hover, onClick, title }: { color: string; hover: string; onClick: () => void; title: string }) => (
    <button
      title={title}
      onClick={onClick}
      className="no-drag h-3 w-3 rounded-full"
      style={{ backgroundColor: color }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = color)}
    />
  );
  return (
    <div className="no-drag flex items-center gap-2">
      <Light title="Close" color="#ff5f57" hover="#ff3b30" onClick={close} />
      <Light title="Minimize" color="#febc2e" hover="#ffb000" onClick={minimize} />
      <span className="h-3 w-3 rounded-full bg-[#ddd]" />
    </div>
  );
}

/** Standalone page shown in the separate mirror window. */
function MirrorPage() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let destroyed = false;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { invoke } = await import("@tauri-apps/api/core");
      const win = getCurrentWindow();
      // Intercept the window close (traffic-light / OS close): stop the mirror
      // (kills scrcpy-server + removes the adb reverse tunnel) before the
      // window is destroyed, so nothing is left running on the device.
      unlisten = await win.onCloseRequested(async (event) => {
        if (destroyed) return;
        event.preventDefault();
        try {
          await invoke("mirror_stop");
        } catch {
          /* ignore */
        }
        destroyed = true;
        win.destroy();
      });
    })();
    return () => unlisten?.();
  }, []);

  async function close() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    // triggers onCloseRequested above, which stops the mirror then destroys
    getCurrentWindow().close();
  }
  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <MirrorTitleBar />
      <div className="min-h-0 flex-1 p-3">
        <MirrorView onClose={close} />
      </div>
    </div>
  );
}

export default function App() {
  // The mirror runs in its own window (?view=mirror), fully separate from the
  // main Droidbench window.
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "mirror") {
    return (
      <I18nProvider>
        <DeviceProvider>
          <MirrorPage />
        </DeviceProvider>
      </I18nProvider>
    );
  }
  if (view === "explorer") {
    return (
      <I18nProvider>
        <DeviceProvider>
          <LogProvider>
            <FileExplorer />
          </LogProvider>
        </DeviceProvider>
      </I18nProvider>
    );
  }
  if (view === "setup") {
    return (
      <I18nProvider>
        <DeviceProvider>
          <ToolsProvider>
            <LogProvider>
              <SetupPage />
            </LogProvider>
          </ToolsProvider>
        </DeviceProvider>
      </I18nProvider>
    );
  }
  return (
    <I18nProvider>
      <DeviceProvider>
        <ToolsProvider>
          <MirrorProvider>
            <LogProvider>
              <DiagnosticProvider>
                <ConnectivityProvider>
                  <AppManagerProvider>
                    <Shell />
                  </AppManagerProvider>
                </ConnectivityProvider>
              </DiagnosticProvider>
            </LogProvider>
          </MirrorProvider>
        </ToolsProvider>
      </DeviceProvider>
    </I18nProvider>
  );
}
