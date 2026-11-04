import type { ComponentType } from "react";
import {
  siAsus,
  siGoogle,
  siHuawei,
  siMotorola,
  siOneplus,
  siOppo,
  siSamsung,
  siSony,
  siVivo,
  siXiaomi,
  type SimpleIcon,
} from "simple-icons";

export type IconComponent = ComponentType<{ size?: number; className?: string }>;

/**
 * Wrap a simple-icons logo as a component with the same props as a lucide icon
 * (size / className), so brand logos and lucide icons are interchangeable in the
 * navigation. Rendered monochrome with `currentColor`, so it follows the tab's
 * active / inactive text color like every other icon.
 *
 * Brand names and logos are trademarks of their owners and are used here only to
 * identify which brand a guide is for. Logo data: simple-icons (CC0).
 */
function brandIcon(icon: SimpleIcon): IconComponent {
  function BrandIcon({ size = 16, className }: { size?: number; className?: string }) {
    return (
      <svg
        role="img"
        aria-label={icon.title}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        className={className}
      >
        <path d={icon.path} />
      </svg>
    );
  }
  return BrandIcon;
}

export const XiaomiIcon = brandIcon(siXiaomi);
export const SamsungIcon = brandIcon(siSamsung);

// Keyed by the brand ids in lib/brandGuides.ts. Brands with no logo available in
// simple-icons (Nothing, Realme) are intentionally absent: the caller falls back
// to a generic phone icon rather than us drawing an imitation logo.
const BY_BRAND: Record<string, IconComponent> = {
  pixel: brandIcon(siGoogle),
  oneplus: brandIcon(siOneplus),
  motorola: brandIcon(siMotorola),
  sony: brandIcon(siSony),
  "oppo-realme": brandIcon(siOppo),
  vivo: brandIcon(siVivo),
  "huawei-honor": brandIcon(siHuawei),
  asus: brandIcon(siAsus),
};

export function brandIconFor(brandId: string): IconComponent | undefined {
  return BY_BRAND[brandId];
}
