import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, CornerDownLeft, Copy } from "lucide-react";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { useDevice } from "../../state/device";
import { useTerminal } from "../../state/terminal";
import { useI18n } from "../../i18n";

// Common read-only commands, one click to run.
const QUICK: { label: string; cmd: string }[] = [
  { label: "getprop", cmd: "getprop ro.product.model" },
  { label: "Battery", cmd: "dumpsys battery" },
  { label: "Storage", cmd: "df -h" },
  { label: "3rd-party apps", cmd: "pm list packages -3" },
  { label: "Top activity", cmd: "dumpsys activity activities | grep mResumedActivity" },
  { label: "IP address", cmd: "ip addr show wlan0" },
];

/** A simple `adb shell` console: one command at a time, output kept while you change tabs. */
export function TerminalTab() {
  const { device } = useDevice();
  const { entries, history, busy, run, clear } = useTerminal();
  const { t } = useI18n();
  const [line, setLine] = useState("");
  const [cursor, setCursor] = useState<number | null>(null); // position in history while browsing with Up / Down
  const endRef = useRef<HTMLDivElement>(null);
  const ready = device.connected && device.mode === "adb";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  function submit() {
    if (!ready || busy || !line.trim()) return;
    void run(line);
    setLine("");
    setCursor(null);
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const i = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(i);
      setLine(history[i]);
    } else if (e.key === "ArrowDown" && cursor !== null) {
      e.preventDefault();
      const i = cursor + 1;
      if (i >= history.length) {
        setCursor(null);
        setLine("");
      } else {
        setCursor(i);
        setLine(history[i]);
      }
    }
  }
  function copyOut() {
    const text = entries.map((e) => `$ ${e.cmd}\n${e.out}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <>
      <TabHelp>{t("term.help")}</TabHelp>

      <Section title={t("term.quick")}>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q.cmd}
              disabled={!ready || busy}
              title={q.cmd}
              onClick={() => void run(q.cmd)}
              className="no-drag rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] font-medium text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)] disabled:opacity-40"
            >
              {q.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("term.title")}>
        <div className="selectable h-[320px] overflow-auto rounded-lg border border-[var(--color-border)] bg-[#0b1220] p-3 font-mono text-[11.5px] leading-snug text-slate-200">
          {entries.length === 0 && <span className="text-slate-500">{ready ? t("term.empty") : t("common.connectFirst")}</span>}
          {entries.map((e) => (
            <div key={e.id} className="mb-2">
              <div className="text-emerald-300">$ {e.cmd}</div>
              {e.state === "running" ? (
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Loader2 size={11} className="animate-spin" /> {t("term.running")}
                </div>
              ) : (
                <pre className={`whitespace-pre-wrap break-words ${e.state === "error" ? "text-rose-300" : ""}`}>
                  {e.out.trim() ? e.out.replace(/\s+$/, "") : <span className="text-slate-500">{t("term.noOutput")}</span>}
                </pre>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="flex gap-1.5">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-[var(--color-ink-faint)]">$</span>
            <input
              value={line}
              onChange={(e) => {
                setLine(e.target.value);
                setCursor(null);
              }}
              onKeyDown={onKey}
              disabled={!ready}
              placeholder={t("term.placeholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="no-drag selectable w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-7 pr-3 font-mono text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
            />
          </div>
          <Button variant="primary" disabled={!ready || busy || !line.trim()} onClick={submit} title={t("term.runHint")}>
            <CornerDownLeft size={14} /> {t("term.run")}
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" disabled={entries.length === 0} onClick={copyOut}>
            <Copy size={12} /> {t("common.copy")}
          </Button>
          <Button size="sm" disabled={entries.length === 0} onClick={clear}>
            <Trash2 size={12} /> {t("term.clear")}
          </Button>
        </div>
      </Section>
    </>
  );
}
