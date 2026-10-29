import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useI18n } from "../../i18n";

export function DumperTab() {
  const t = useTools();
  const { push } = useLog();
  const { t: tr } = useI18n();

  async function dumpPayload() {
    const zip = await open({
      multiple: false,
      filters: [{ name: "OTA ZIP / payload", extensions: ["zip", "bin"] }],
    });
    if (typeof zip !== "string") return;
    const out = await open({ directory: true, multiple: false, title: tr("du.outTitle") });
    if (typeof out !== "string") {
      push(tr("du.selectOut"), "stderr");
      return;
    }
    t.payloadDumper(["-o", out, zip]);
  }

  async function extractZip() {
    const zip = await open({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (typeof zip !== "string") return;
    const out = await open({ directory: true, multiple: false, title: tr("du.outTitle") });
    if (typeof out !== "string") {
      push(tr("du.selectOut"), "stderr");
      return;
    }
    t.raw("unzip", ["-o", zip, "-d", out], true);
  }

  return (
    <>
      <TabHelp>{tr("du.help")}</TabHelp>

      <Section title={tr("du.payloadSec")}>
        <Button size="block" variant="success" title={tr("du.dumpPayloadHint")} onClick={dumpPayload}>
          {tr("du.dumpPayload")}
        </Button>
        <Button size="block" title={tr("du.extractZipHint")} onClick={extractZip}>
          {tr("du.extractZip")}
        </Button>
      </Section>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-[var(--color-ink-soft)]">
        {tr("du.note")}
      </div>
    </>
  );
}
