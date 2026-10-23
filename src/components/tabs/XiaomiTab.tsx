import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Section } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";

export function XiaomiTab() {
  const t = useTools();
  const { push } = useLog();
  const [fwFolder, setFwFolder] = useState<string>("");
  const [skipProduct, setSkipProduct] = useState(false);
  const [disableAntiRollback, setDisableAntiRollback] = useState(false);

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setFwFolder(dir);
      push(`Firmware folder selected: ${dir}`, "system");
    }
  }

  function executeFlash() {
    if (!fwFolder) {
      push("Select a firmware folder first.", "stderr");
      return;
    }
    // MIUI fastboot packages ship flash_all scripts. We locate one and run it.
    // Best-effort: run the shell/bat flash_all from the folder.
    const script = fwFolder + (skipProduct ? "/flash_all_except_storage" : "/flash_all");
    const ext = navigatorIsWindows() ? ".bat" : ".sh";
    push(
      `Executing flash script: ${script}${ext}` +
        (disableAntiRollback ? " (anti-rollback disabled)" : ""),
      "system",
    );
    t.raw(script + ext, [], true);
  }

  return (
    <>
      <Section title="Firmware">
        <Button size="block" variant="primary" onClick={pickFolder}>
          Select firmware folder
        </Button>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-ink-soft)]">
          {fwFolder || "— no folder selected —"}
        </div>
      </Section>

      <Section title="Script options">
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={skipProduct}
            onChange={(e) => setSkipProduct(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          Skip product check (flash_all_except_storage)
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={disableAntiRollback}
            onChange={(e) => setDisableAntiRollback(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          Disable anti-rollback
        </label>
      </Section>

      <Section title="Mi Unlock">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Mi Unlock requires Xiaomi's official tool &amp; account. Launch it, then
          follow the on-screen unlock flow.
        </div>
      </Section>

      <Section>
        <Button size="block" variant="danger" onClick={executeFlash}>
          Execute Flash
        </Button>
      </Section>
    </>
  );
}

function navigatorIsWindows() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}
