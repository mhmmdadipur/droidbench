import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDevice } from "../state/device";

const appWindow = getCurrentWindow();

/** macOS-style traffic light button. */
function Light({
  color,
  hover,
  glyph,
  onClick,
  title,
}: {
  color: string;
  hover: string;
  glyph: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="no-drag group flex h-3 w-3 items-center justify-center rounded-full"
      style={{ backgroundColor: color }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = color)}
    >
      <span className="text-[8px] font-bold leading-none text-black/55 opacity-0 group-hover:opacity-100">
        {glyph}
      </span>
    </button>
  );
}

export function TitleBar() {
  const { device } = useDevice();

  return (
    <div
      data-tauri-drag-region
      className="drag flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4"
    >
      {/* traffic lights */}
      <div className="no-drag flex items-center gap-2">
        <Light
          title="Close"
          color="#ff5f57"
          hover="#ff3b30"
          glyph="✕"
          onClick={() => appWindow.close()}
        />
        <Light
          title="Minimize"
          color="#febc2e"
          hover="#ffb000"
          glyph="–"
          onClick={() => appWindow.minimize()}
        />
        <Light
          title="Zoom"
          color="#28c840"
          hover="#1aad2b"
          glyph="+"
          onClick={() => appWindow.toggleMaximize()}
        />
      </div>

      {/* app title */}
      <div className="ml-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--color-brand)] text-[11px] font-bold text-white">
          D
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
          Droidbench
        </span>
      </div>

      {/* right: live device chip */}
      <div className="ml-auto flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            device.connected ? "bg-[var(--color-ok)]" : "bg-[var(--color-ink-faint)]"
          }`}
        />
        <span className="text-xs text-[var(--color-ink-soft)]">
          {device.connected
            ? `${device.mode.toUpperCase()}${device.model ? ` · ${device.model}` : ""}`
            : "No device"}
        </span>
      </div>
    </div>
  );
}
