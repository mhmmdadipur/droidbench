import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Ban, Trash2 } from "lucide-react";
import { useLog } from "../state/log";
import { Button } from "./ui/Button";

const streamColor: Record<string, string> = {
  stdout: "text-[var(--color-ink)]",
  stderr: "text-[var(--color-danger-600)]",
  system: "text-[var(--color-brand-600)]",
};

export function LogPanel() {
  const { entries, running, clear, cancel } = useLog();
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (errorsOnly && e.stream !== "stderr") return false;
      if (query && !e.text.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [entries, query, errorsOnly]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">Command Log</span>
        <div className="relative ml-auto w-64">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search log…"
            className="no-drag h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-8 pr-2 text-xs outline-none focus:border-[var(--color-brand)]"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
            className="accent-[var(--color-danger)]"
          />
          Errors only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          Auto-scroll
        </label>
      </div>

      {/* body */}
      <div
        ref={scrollRef}
        className="selectable flex-1 overflow-auto bg-[var(--color-bg)] px-4 py-3 font-mono text-[12.5px] leading-relaxed"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {filtered.length === 0 ? (
          <div className="text-[var(--color-ink-faint)]">No log lines.</div>
        ) : (
          filtered.map((e) => (
            <div key={e.key} className={`whitespace-pre-wrap break-words ${streamColor[e.stream]}`}>
              {e.text}
            </div>
          ))
        )}
      </div>

      {/* footer */}
      <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
        <Button
          variant="danger"
          size="md"
          className="flex-1"
          disabled={!running}
          onClick={cancel}
        >
          <Ban size={15} /> Cancel Running Command
        </Button>
        <Button variant="default" size="md" className="flex-1" onClick={clear}>
          <Trash2 size={15} /> Clear Log
        </Button>
      </div>
    </div>
  );
}
