import { useState } from "react";
import { Bug, Timer, Crosshair, Eye } from "lucide-react";
import { Button } from "../ui/Button";
import { Section, TabHelp } from "../ui/Section";
import { AppCombobox } from "../ui/AppCombobox";
import { runCapture } from "../../lib/api";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useI18n } from "../../i18n";

export function DeveloperTab() {
  const t = useTools();
  const { push } = useLog();
  const { device } = useDevice();
  const { t: tr } = useI18n();
  const [pkg, setPkg] = useState("");
  const [events, setEvents] = useState(500);

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push("No device connected in ADB mode.", "stderr");
      return false;
    }
    return true;
  }
  function needTarget(): boolean {
    if (!pkg.trim()) {
      push(tr("dev.needTarget"), "stderr");
      return false;
    }
    return guard();
  }

  async function coldStart() {
    if (!needTarget()) return;
    const p = pkg.trim();
    push(`Cold-start test for ${p}…`, "system");
    await runCapture("adb", ["shell", "am", "force-stop", p]);
    const out = await runCapture("adb", [
      "shell",
      "monkey",
      "-p",
      p,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]).catch(() => "");
    if (out) push(out.trim(), "stdout");
    // measure via am start -W on the resolved launcher activity
    const res = await runCapture("adb", ["shell", "cmd", "activity", "start", "-W", p]).catch(() => "");
    const tt = /TotalTime:\s*(\d+)/.exec(res)?.[1];
    push(tt ? `Startup TotalTime: ${tt} ms` : "Started (timing not reported).", "system");
  }

  async function topActivity() {
    if (!guard()) return;
    const out = await runCapture("adb", ["shell", "dumpsys", "activity", "activities"]);
    const m = /(?:topResumedActivity|ResumedActivity)[^\n]*\{[^}]*\s(\S+\/\S+)/.exec(out);
    push(m ? `Current activity: ${m[1]}` : "Could not read current activity.", m ? "stdout" : "stderr");
  }

  function toggle(ns: string, key: string, label: string) {
    if (!guard()) return;
    runCapture("adb", ["shell", "settings", "get", ns, key]).then((cur) => {
      const on = cur.trim() === "1" || cur.trim().toLowerCase() === "true";
      const next = on ? "0" : "1";
      runCapture("adb", ["shell", "settings", "put", ns, key, next]).then(() => {
        push(`${label} → ${next === "1" ? "ON" : "OFF"} (may need app relaunch).`, "system");
      });
    });
  }

  return (
    <>
      <TabHelp>{tr("dev.help")}</TabHelp>

      <Section title={tr("dev.target")}>
        <AppCombobox value={pkg} onChange={setPkg} placeholder={tr("dev.targetPlaceholder")} />
      </Section>

      <Section title={tr("dev.stress.title")}>
        <label className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-ink-soft)]">
          <span>{tr("dev.stress.events")}</span>
          <input
            type="number"
            min={1}
            value={events}
            onChange={(e) => setEvents(Math.max(1, Number(e.target.value) || 1))}
            className="no-drag w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-right text-[12px] outline-none focus:border-[var(--color-brand)]"
          />
        </label>
        <Button
          size="block"
          variant="danger"
          title={tr("dev.stress.runHint")}
          onClick={() => {
            if (!needTarget()) return;
            push(`Monkey: ${events} events → ${pkg.trim()}`, "system");
            t.adb(["shell", "monkey", "-p", pkg.trim(), "-v", String(events)]);
          }}
        >
          <Bug size={14} /> {tr("dev.stress.run")}
        </Button>
      </Section>

      <Section title={tr("dev.topactivity")}>
        <Button size="block" title={tr("dev.coldstartHint")} onClick={coldStart}>
          <Timer size={14} /> {tr("dev.coldstart")}
        </Button>
        <Button size="block" title={tr("dev.topactivityHint")} onClick={topActivity}>
          <Crosshair size={14} /> {tr("dev.topactivity")}
        </Button>
      </Section>

      <Section title={tr("dev.toggles")}>
        <Button size="block" title={tr("dev.overdrawHint")} onClick={() => toggle("global", "debug.hwui.overdraw", tr("dev.overdraw"))}>
          <Eye size={14} /> {tr("dev.overdraw")}
        </Button>
        <Button size="block" title={tr("dev.layoutHint")} onClick={() => toggle("global", "debug.layout", tr("dev.layout"))}>
          <Eye size={14} /> {tr("dev.layout")}
        </Button>
        <Button size="block" title={tr("dev.pointerHint")} onClick={() => toggle("system", "pointer_location", tr("dev.pointer"))}>
          <Eye size={14} /> {tr("dev.pointer")}
        </Button>
      </Section>
    </>
  );
}
