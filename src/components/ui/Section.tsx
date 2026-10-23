import { type ReactNode } from "react";

/** A short, layman-friendly explanation shown at the top of each tab. */
export function TabHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] leading-snug text-sky-800">
      <span className="mt-[1px] shrink-0">ℹ️</span>
      <span>{children}</span>
    </div>
  );
}

/** A labelled group of controls, matching the "ADB Commands / Reboot Info" sections. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      {title && (
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-600)]">
          {title}
        </div>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

/** Row helper that lays children out in equal columns. */
export function Row({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}
