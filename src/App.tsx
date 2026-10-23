import { useEffect, useState } from "react";
import {
  Smartphone,
  Zap,
  Boxes,
  PackageOpen,
  Trash2,
  FolderOpen,
  RefreshCw,
  HelpCircle,
  Download,
} from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { DeviceStatus } from "./components/DeviceStatus";
import { ToolsBar } from "./components/ToolsBar";
import { LogPanel } from "./components/LogPanel";
import { MirrorView } from "./components/mirror/MirrorView";
import { MirrorTitleBar } from "./components/mirror/MirrorTitleBar";
import { AdbTab } from "./components/tabs/AdbTab";
import { FastbootTab } from "./components/tabs/FastbootTab";
import { XiaomiTab } from "./components/tabs/XiaomiTab";
import { SamsungTab } from "./components/tabs/SamsungTab";
import { DumperTab } from "./components/tabs/DumperTab";
import { DebloatTab } from "./components/tabs/DebloatTab";
import { DeviceProvider } from "./state/device";
import { LogProvider, useLog } from "./state/log";
import { ToolsProvider } from "./state/tools";
import { MirrorProvider } from "./state/mirror";

type TabId = "adb" | "fastboot" | "xiaomi" | "samsung" | "dumper" | "debloat";

const TABS: { id: TabId; label: string; icon: typeof Smartphone; desc: string }[] = [
  { id: "adb", label: "ADB", icon: Smartphone, desc: "Cermin layar, reboot, update" },
  { id: "fastboot", label: "Fastboot", icon: Zap, desc: "Flash & buka bootloader" },
  { id: "xiaomi", label: "Xiaomi", icon: Boxes, desc: "Flash firmware MIUI/HyperOS" },
  { id: "samsung", label: "Samsung", icon: PackageOpen, desc: "Flash via Odin/Heimdall" },
  { id: "dumper", label: "Dumper", icon: Download, desc: "Ekstrak isi OTA/payload" },
  { id: "debloat", label: "Debloat", icon: Trash2, desc: "Nonaktifkan bloatware" },
];

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "adb":
      return <AdbTab />;
    case "fastboot":
      return <FastbootTab />;
    case "xiaomi":
      return <XiaomiTab />;
    case "samsung":
      return <SamsungTab />;
    case "dumper":
      return <DumperTab />;
    case "debloat":
      return <DebloatTab />;
  }
}

function BottomToolbar() {
  const { push, run } = useLog();

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
      {item("Buka File HP", "Lihat isi penyimpanan HP (folder /sdcard) dari komputer.", FolderOpen, openFiles)}
      {item("Cek Perangkat", "Tampilkan HP yang terhubung & statusnya (apakah terdeteksi).", Smartphone, listDevices)}
      {item("Restart Koneksi", "Mulai ulang koneksi ADB jika HP tidak terdeteksi / error.", RefreshCw, restartConnection)}
      {item("Bantuan Koneksi", "Panduan cara menyambungkan HP (USB debugging, dll).", HelpCircle, connectionHelp)}
    </div>
  );
}

function Shell() {
  const [tab, setTab] = useState<TabId>("adb");
  const activeTab = TABS.find((t) => t.id === tab);

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <TitleBar />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* COLUMN 1 — status + navigation */}
        <div className="flex w-[244px] shrink-0 flex-col gap-3">
          <DeviceStatus />
          <ToolsBar />

          {/* vertical tab bar with label + description */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-sm">
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              Tools
            </div>
            <div className="flex flex-col gap-0.5">
              {TABS.map((tb) => {
                const Icon = tb.icon;
                const active = tab === tb.id;
                return (
                  <button
                    key={tb.id}
                    onClick={() => setTab(tb.id)}
                    title={tb.desc}
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
                        {tb.label}
                      </span>
                      <span className="block truncate text-[10.5px] leading-tight text-[var(--color-ink-faint)]">
                        {tb.desc}
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
              {activeTab?.label}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
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
  const isMirror = new URLSearchParams(window.location.search).get("view") === "mirror";
  if (isMirror) {
    return (
      <DeviceProvider>
        <MirrorPage />
      </DeviceProvider>
    );
  }
  return (
    <DeviceProvider>
      <ToolsProvider>
        <MirrorProvider>
          <LogProvider>
            <Shell />
          </LogProvider>
        </MirrorProvider>
      </ToolsProvider>
    </DeviceProvider>
  );
}
