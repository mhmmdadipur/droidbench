import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/utils";

type Variant = "default" | "primary" | "success" | "danger" | "violet" | "info" | "ghost";
type Size = "sm" | "md" | "block";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  default:
    "bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-slate-200 border border-[var(--color-border)]",
  primary:
    "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)] shadow-sm",
  success: "bg-[var(--color-ok)] text-white hover:brightness-95 shadow-sm",
  danger: "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-600)] shadow-sm",
  violet: "bg-[var(--color-violet)] text-white hover:brightness-95 shadow-sm",
  info: "bg-[var(--color-info)] text-white hover:brightness-95 shadow-sm",
  ghost: "bg-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)]",
};

const sizes: Record<Size, string> = {
  sm: "min-h-7 px-2.5 text-xs",
  md: "min-h-9 px-3 py-1.5 text-[13px]",
  block: "min-h-10 w-full px-3.5 py-2 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "no-drag inline-flex items-center justify-center gap-1.5 rounded-lg text-center font-medium leading-tight transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
