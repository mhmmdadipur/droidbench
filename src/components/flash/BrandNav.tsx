import { Smartphone } from "lucide-react";
import { Button } from "../ui/Button";
import { BRANDS } from "../../lib/brandGuides";
import { useFlashing } from "../../state/flashing";
import { useI18n } from "../../i18n";
import { brandIconFor, SamsungIcon, XiaomiIcon } from "../ui/BrandIcons";

/**
 * Grid of buttons that jump to a brand's own guide tab. The last button opens the
 * "Other brands" step inside the Fastboot tab, which covers every brand that does
 * not have a tab of its own.
 */
export function BrandNav({ includeMain = false }: { includeMain?: boolean }) {
  const { goToTab, showStep } = useFlashing();
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {includeMain && (
        <>
          <Button size="sm" onClick={() => goToTab("xiaomi")}>
            <XiaomiIcon size={13} /> Xiaomi
          </Button>
          <Button size="sm" onClick={() => goToTab("samsung")}>
            <SamsungIcon size={13} /> Samsung
          </Button>
        </>
      )}
      {BRANDS.map((b) => {
        const Icon = brandIconFor(b.id) ?? Smartphone;
        return (
          <Button key={b.id} size="sm" onClick={() => goToTab(`brand-${b.id}`)}>
            <Icon size={13} /> {b.name}
          </Button>
        );
      })}
      <Button
        size="sm"
        onClick={() => {
          showStep("fastboot", 4);
          goToTab("fastboot");
        }}
      >
        <Smartphone size={13} /> {t("fb.step.other")}
      </Button>
    </div>
  );
}
