import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ChevronDown, X } from "lucide-react";
import { useAppManager } from "../../state/appmanager";
import { useDevice } from "../../state/device";
import { deriveAppName } from "../../lib/apps";
import { useI18n } from "../../i18n";

/**
 * A text field + filtered dropdown (combobox) for picking an installed app.
 * - Typing filters by app name or package.
 * - If the installed-app list isn't loaded yet, the first interaction triggers
 *   a shared scan (shows a spinner), then filters.
 * - Value is the selected package name ("" = none).
 */
export function AppCombobox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (pkg: string) => void;
  placeholder?: string;
}) {
  const { all, scanApps, scanning } = useAppManager();
  const { device } = useDevice();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // keep the field showing the selected app's name when not actively editing
  useEffect(() => {
    if (!open) setText(value ? `${deriveAppName(value)} — ${value}` : "");
  }, [value, open]);

  // close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function ensureScanned() {
    if (all.length === 0 && !scanning && device.connected && device.mode === "adb") {
      await scanApps().catch(() => {});
    }
  }

  const q = text.trim().toLowerCase();
  const filtered = useMemo(() => {
    // when the field just shows the current selection, list everything
    const isSelectionLabel = value && text === `${deriveAppName(value)} — ${value}`;
    const query = isSelectionLabel ? "" : q;
    const list = query
      ? all.filter(
          (p) => p.toLowerCase().includes(query) || deriveAppName(p).toLowerCase().includes(query),
        )
      : all;
    return list.slice(0, 200);
  }, [all, q, value, text]);

  function pick(pkg: string) {
    onChange(pkg);
    setText(pkg ? `${deriveAppName(pkg)} — ${pkg}` : "");
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="relative">
        <input
          value={text}
          onFocus={() => {
            setOpen(true);
            ensureScanned();
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            ensureScanned();
          }}
          placeholder={placeholder ?? t("log.byAppAll")}
          className="no-drag w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-3 pr-14 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {value && (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                pick("");
              }}
              className="no-drag rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              title="Clear"
            >
              <X size={13} />
            </button>
          )}
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen((o) => !o);
              ensureScanned();
            }}
            className="no-drag rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 max-h-[240px] w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
          {scanning && all.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">
              <Loader2 size={13} className="animate-spin" /> {t("common.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">
              {all.length === 0 ? t("common.loading") : t("app.noMatch")}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`no-drag flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-bg)] ${
                  p === value ? "bg-[var(--color-brand-50)]" : ""
                }`}
              >
                <span className="truncate text-[12px] font-medium text-[var(--color-ink)]">
                  {deriveAppName(p)}
                </span>
                <span className="truncate font-mono text-[9.5px] text-[var(--color-ink-faint)]">{p}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
