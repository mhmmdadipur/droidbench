import { useEffect, useState } from "react";
import {
  Smartphone,
  Zap,
  Boxes,
  PackageOpen,
  Trash2,
  FolderOpen,
  Terminal,
  Cpu,
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

const TABS: { id: TabId; label: string; icon: typeof Smartphone }[] = [
  { id: "adb", label: "ADB", icon: Smartphone },
  { id: "fastboot", label: "Fastboot", icon: Zap },
  { id: "xiaomi", label: "Xiaomi", icon: Boxes },
  { id: "samsung", label: "Samsung", icon: PackageOpen },
  { id: "dumper", label: "Dumper", icon: Download },
  { id: "debloat", label: "Debloat", icon: Trash2 },
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
  const { push } = useLog();
  const item = (label: string, Icon: typeof Smartphone, onClick: () => void) => (
    <button
      onClick={onClick}
      className="no-drag flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-xs font-medium text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
    >
      <Icon size={14} />
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {item("File Explorer", FolderOpen, () => push("File Explorer: not yet wired.", "system"))}
      {item("Terminal", Terminal, () => push("Terminal: not yet wired.", "system"))}
      {item("Dev Manager", Cpu, () => push("Device Manager: not yet wired.", "system"))}
      {item("Install Driver", Download, () => push("Install Driver: not yet wired.", "system"))}
    </div>
  );
}

function Shell() {
  const [tab, setTab] = useState<TabId>("adb");

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <TitleBar />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* LEFT panel */}
        <div className="flex w-[300px] shrink-0 flex-col gap-3">
          <DeviceStatus />
          <ToolsBar />

          {/* tab bar */}
          <div className="grid grid-cols-3 gap-1.5">
            {TABS.map((tb) => {
              const Icon = tb.icon;
              const active = tab === tb.id;
              return (
                <button
                  key={tb.id}
                  onClick={() => setTab(tb.id)}
                  className={`no-drag flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium transition-colors ${
                    active
                      ? "border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <Icon size={16} />
                  {tb.label}
                </button>
              );
            })}
          </div>

          {/* tab content (scrolls) */}
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <TabContent tab={tab} />
          </div>

          <BottomToolbar />
        </div>

        {/* RIGHT: log, or live mirror when mirroring */}
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
