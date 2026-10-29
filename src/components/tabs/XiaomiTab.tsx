import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useI18n } from "../../i18n";

export function XiaomiTab() {
  const t = useTools();
  const { push } = useLog();
  const { t: tr } = useI18n();
  const [fwFolder, setFwFolder] = useState<string>("");
  const [skipProduct, setSkipProduct] = useState(false);
  const [disableAntiRollback, setDisableAntiRollback] = useState(false);

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setFwFolder(dir);
      push(tr("xi.folderSelected", { dir }), "system");
    }
  }

  function executeFlash() {
    if (!fwFolder) {
      push(tr("xi.selectFolderFirst"), "stderr");
      return;
    }
    const script = fwFolder + (skipProduct ? "/flash_all_except_storage" : "/flash_all");
    const ext = navigatorIsWindows() ? ".bat" : ".sh";
    push(
      tr("xi.executing", {
        script: script + ext,
        arb: disableAntiRollback ? tr("xi.arb") : "",
      }),
      "system",
    );
    t.raw(script + ext, [], true);
  }

  return (
    <>
      <TabHelp>{tr("xi.help")}</TabHelp>

      <Section title={tr("xi.folderSec")}>
        <Button size="block" variant="primary" title={tr("xi.pickFolderHint")} onClick={pickFolder}>
          {tr("xi.pickFolder")}
        </Button>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-ink-soft)]">
          {fwFolder || tr("xi.noFolder")}
        </div>
      </Section>

      <Section title={tr("xi.options")}>
        <label
          className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]"
          title={tr("xi.keepDataHint")}
        >
          <input
            type="checkbox"
            checked={skipProduct}
            onChange={(e) => setSkipProduct(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          {tr("xi.keepData")}
        </label>
        <label
          className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]"
          title={tr("xi.disableArbHint")}
        >
          <input
            type="checkbox"
            checked={disableAntiRollback}
            onChange={(e) => setDisableAntiRollback(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          {tr("xi.disableArb")}
        </label>
      </Section>

      <Section title={tr("xi.unlockSec")}>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {tr("xi.unlockNote")}
        </div>
      </Section>

      <Section>
        <Button size="block" variant="danger" title={tr("xi.flashHint")} onClick={executeFlash}>
          {tr("xi.flash")}
        </Button>
      </Section>
    </>
  );
}

function navigatorIsWindows() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}
