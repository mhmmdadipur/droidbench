import { type ReactNode } from "react";

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
