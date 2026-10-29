import { useState } from "react";
import { Play, Square, Eraser, Save, Bug } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useI18n, type TKey } from "../../i18n";

type Level = "V" | "D" | "I" | "W" | "E";

const LEVELS: { id: Level; labelKey: TKey; hintKey: TKey }[] = [
  { id: "V", labelKey: "log.level.v", hintKey: "log.level.v.h" },
  { id: "D", labelKey: "log.level.d", hintKey: "log.level.d.h" },
  { id: "I", labelKey: "log.level.i", hintKey: "log.level.i.h" },
  { id: "W", labelKey: "log.level.w", hintKey: "log.level.w.h" },
  { id: "E", labelKey: "log.level.e", hintKey: "log.level.e.h" },
];

export function LogcatTab() {
  const { push, run, cancel, running } = useLog();
  const { device } = useDevice();
  const { t } = useI18n();
  const [level, setLevel] = useState<Level>("E");
  const [tag, setTag] = useState("");
  const [crashOnly, setCrashOnly] = useState(false);

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push("No device connected in ADB mode.", "stderr");
      return false;
    }
    return true;
  }

  async function start() {
    if (!guard()) return;
    if (crashOnly) {
      push("Starting Logcat (crashes only)…", "system");
      run("adb", ["logcat", "-v", "brief", "-s", "AndroidRuntime:E", "DEBUG:F", "System.err:W"]);
      return;
    }
    push(`Starting Logcat (level ${level}${tag ? `, filter "${tag}"` : ""})…`, "system");
    const args = ["logcat", "-v", "brief"];
    if (tag.trim()) {
      args.push(`${tag.trim()}:${level}`, "*:S");
    } else {
      args.push(`*:${level}`);
    }
    run("adb", args);
  }

  function stop() {
    cancel();
    push("Logcat stopped.", "system");
  }

  async function clearBuffer() {
    if (!guard()) return;
    push("Clearing log buffer on device…", "system");
    run("adb", ["logcat", "-c"]);
  }

  async function saveToFile() {
    if (!guard()) return;
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const devPath = `/sdcard/droidbench-logcat-${stamp}.txt`;
    const dest = `${dir}/logcat-${stamp}.txt`;
    push(`Saving log to ${dest}…`, "system");
    run("adb", ["shell", `logcat -d -v threadtime > ${devPath}`]);
    setTimeout(() => {
      run("adb", ["pull", devPath, dest]);
      setTimeout(() => run("adb", ["shell", "rm", devPath]), 1500);
    }, 800);
  }

  async function bugReport() {
    if (!guard()) return;
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = `${dir}/bugreport-${stamp}.zip`;
    push(`Generating bug report → ${dest} (this can take a few minutes)…`, "system");
    run("adb", ["bugreport", dest]);
  }

  return (
    <>
      <TabHelp>{t("log.help")}</TabHelp>

      <Section title={t("log.level")}>
        <div className="grid grid-cols-5 gap-1">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              title={t(l.hintKey)}
              disabled={crashOnly}
              onClick={() => setLevel(l.id)}
              className={`rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                level === l.id
                  ? "bg-[var(--color-brand)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-ink-soft)] hover:bg-slate-200"
              }`}
            >
              {t(l.labelKey)}
            </button>
          ))}
        </div>
        <label className="mt-1 flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]" title={t("log.crashOnlyHint")}>
          <input type="checkbox" checked={crashOnly} onChange={(e) => setCrashOnly(e.target.checked)} className="accent-[var(--color-brand)]" />
          {t("log.crashOnly")}
        </label>
      </Section>

      <Section title={t("log.filter")}>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          disabled={crashOnly}
          placeholder={t("log.filterPlaceholder")}
          className="no-drag w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
        />
        <div className="text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
          {t("log.filterNote")}
        </div>
      </Section>

      <Section title={t("log.control")}>
        <Row>
          {running ? (
            <Button variant="danger" title={t("log.stopHint")} onClick={stop}>
              <Square size={13} /> {t("log.stop")}
            </Button>
          ) : (
            <Button variant="primary" title={t("log.startHint")} onClick={start}>
              <Play size={13} /> {t("log.start")}
            </Button>
          )}
          <Button title={t("log.clearBufHint")} onClick={clearBuffer}>
            <Eraser size={13} /> {t("log.clearBuf")}
          </Button>
        </Row>
      </Section>

      <Section title={t("log.extra")}>
        <Button size="block" title={t("log.saveFileHint")} onClick={saveToFile}>
          <Save size={13} /> {t("log.saveFile")}
        </Button>
        <Button size="block" title={t("log.bugreportHint")} onClick={bugReport}>
          <Bug size={13} /> {t("log.bugreport")}
        </Button>
      </Section>
    </>
  );
}

