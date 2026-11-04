import { useState, type ReactNode } from "react";
import { Check, Circle, Loader2, AlertTriangle, ChevronDown } from "lucide-react";

export type StepState = "todo" | "active" | "done" | "warn";
export type StatusTone = "ok" | "bad" | "neutral" | "warn";

/** The step-progress dot on the left rail (reflects overall step state). */
function StepDot({ state }: { state: StepState }) {
  const base = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border";
  switch (state) {
    case "done":
      return (
        <span className={`${base} border-[var(--color-ok)] bg-[var(--color-ok)] text-white`}>
          <Check size={13} />
        </span>
      );
    case "active":
      return (
        <span className={`${base} border-[var(--color-brand)] bg-[var(--color-brand)] text-white`}>
          <Loader2 size={13} className="animate-spin" />
        </span>
      );
    case "warn":
      return (
        <span className={`${base} border-amber-400 bg-amber-100 text-amber-700`}>
          <AlertTriangle size={13} />
        </span>
      );
    default:
      return (
        <span className={`${base} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]`}>
          <Circle size={9} />
        </span>
      );
  }
}

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-emerald-500",
  bad: "bg-rose-500",
  warn: "bg-amber-500",
  neutral: "bg-slate-300",
};
const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-emerald-700",
  bad: "text-rose-700",
  warn: "text-amber-700",
  neutral: "text-[var(--color-ink-faint)]",
};

/**
 * A compact colored status indicator shown in the step header. It's just a
 * colored dot (color = tone); hovering it reveals a tiny info tooltip with the
 * full status text. Replaces the old long text badge so the step title can use
 * the full width without truncation.
 */
function StatusDot({ tone, label }: { tone: StatusTone; label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      className="relative flex shrink-0 items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${TONE_DOT[tone]}`} aria-label={label} title={label} />
      {hover && (
        <span
          className={`pointer-events-none absolute right-0 top-5 z-20 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[10px] font-semibold shadow-lg ${TONE_TEXT[tone]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * One step in a guided flow. Collapsible: the body only renders when `open`.
 * Status is shown as a colored dot (with a hover tooltip) via `statusTone` +
 * `statusLabel`, so the title keeps the full width (no ellipsis).
 */
export function Step({
  index,
  title,
  state = "todo",
  open,
  onToggle,
  statusTone,
  statusLabel,
  children,
}: {
  index: number;
  title: string;
  state?: StepState;
  open: boolean;
  onToggle: () => void;
  statusTone?: StatusTone;
  statusLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={onToggle}
        className="no-drag flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <StepDot state={state} />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-2)] text-[10px] font-bold text-[var(--color-ink-soft)]">
          {index}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-tight text-[var(--color-ink)]">
          {title}
        </span>
        {statusTone && statusLabel && <StatusDot tone={statusTone} label={statusLabel} />}
        <ChevronDown
          size={15}
          className={`shrink-0 text-[var(--color-ink-faint)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-3 py-3">{children}</div>
      )}
    </div>
  );
}

/** Vertical container for a sequence of steps. */
export function StepList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}
