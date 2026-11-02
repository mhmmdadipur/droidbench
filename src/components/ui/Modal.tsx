import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The app's default popup style: a centered overlay card with a header
 * (icon + title + optional close), a scrollable body, and an optional footer.
 * Use this for every in-app dialog so they all look identical.
 */
export function Modal({
  icon: Icon,
  title,
  onClose,
  dismissable = true,
  footer,
  children,
  maxWidth = "max-w-lg",
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: ReactNode;
  /** called when the user closes via the X or the backdrop (only if dismissable) */
  onClose?: () => void;
  /** when false, no X and backdrop clicks don't close (e.g. a required prompt) */
  dismissable?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}) {
  // lock background scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => dismissable && onClose?.()}
    >
      <div
        className={`flex max-h-[85vh] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          {Icon && <Icon size={16} className="text-[var(--color-brand-600)]" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-ink)]">
            {title}
          </span>
          {dismissable && onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>

        {/* footer (optional) */}
        {footer && (
          <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
