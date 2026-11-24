import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

type Placement = { right: number; width: number; top?: number; bottom?: number };

/**
 * A "?" button that shows a small explanation box while the pointer is over it (or it
 * has keyboard focus). Used instead of always-visible helper text so panels stay compact.
 *
 * The box is rendered through a portal with `position: fixed`: the controls panel scrolls
 * (`overflow: auto`), which would clip an absolutely-positioned box. It is right-aligned
 * to the button (the panel sits at the right edge of the window, so it opens leftwards over
 * the video), opens upwards when the button is low in the window, and closes on scroll.
 *
 * variant "inline": small, for section titles.  variant "box": a bordered square the same
 * height as the panel buttons, placed to the right of a button.
 */
export function HelpTip({
  children,
  variant = "inline",
  label = "Bantuan",
  width = 232,
}: {
  children: ReactNode;
  variant?: "inline" | "box";
  label?: string;
  width?: number;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const id = useId();

  function show() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const edge = 8;
    const right = Math.max(edge, window.innerWidth - r.right);
    const w = Math.min(width, window.innerWidth - right - edge);
    if (r.top > window.innerHeight * 0.55) {
      setPlace({ right, width: w, bottom: window.innerHeight - r.top + 6 });
    } else {
      setPlace({ right, width: w, top: r.bottom + 6 });
    }
  }
  const hide = () => setPlace(null);

  // the button can scroll away from a fixed-position box: close it instead of leaving it behind
  useEffect(() => {
    if (!place) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [place]);

  const base =
    "no-drag flex shrink-0 items-center justify-center text-[var(--color-ink-faint)] outline-none transition-colors hover:text-[var(--color-brand-600)] focus-visible:text-[var(--color-brand-600)]";
  const look =
    variant === "box"
      ? "h-[38px] w-[38px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]"
      : "h-5 w-5 rounded-full hover:bg-[var(--color-surface-2)]";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={place ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`${base} ${look}`}
      >
        <HelpCircle size={variant === "box" ? 16 : 14} />
      </button>
      {place &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ position: "fixed", right: place.right, top: place.top, bottom: place.bottom, width: place.width }}
            className="pointer-events-none z-[10000] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-[var(--color-ink-soft)] shadow-xl"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
