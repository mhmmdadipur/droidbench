import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

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

/** White, traffic-light title bar matching the main Droidbench window. */
export function MirrorTitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="drag flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4"
    >
      <div className="no-drag flex items-center gap-2">
        <Light title="Close" color="#ff5f57" hover="#ff3b30" glyph="✕" onClick={() => appWindow.close()} />
        <Light title="Minimize" color="#febc2e" hover="#ffb000" glyph="–" onClick={() => appWindow.minimize()} />
        <Light title="Zoom" color="#28c840" hover="#1aad2b" glyph="+" onClick={() => appWindow.toggleMaximize()} />
      </div>
      <div className="ml-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--color-brand)] text-[11px] font-bold text-white">
          D
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
          Droidbench Mirror
        </span>
      </div>
    </div>
  );
}
