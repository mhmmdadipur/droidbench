import {
  Usb,
  ShieldQuestion,
  Plug,
  CheckCircle2,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { Button } from "./ui/Button";
import { useDevice } from "../state/device";
import { useTools2 } from "../state/tools";
import { useLog } from "../state/log";
import { useI18n, type TKey } from "../i18n";

/**
 * First-run / connection guide. Shown in the content column whenever there is
 * no READY adb device, adapting its steps to the detected state:
 *   - adb ready        → success banner
 *   - unauthorized     → "tap Allow on the phone"
 *   - offline          → replug / restart link
 *   - nothing / none   → plug in + enable USB debugging walkthrough
 */
export function SetupWizard() {
  const { device, refresh, refreshing } = useDevice();
  const { tools } = useTools2();
  const { run, push } = useLog();
  const { t } = useI18n();

  const coreMissing = tools.filter(
    (x) => ["adb", "fastboot"].includes(x.name) && x.source === "missing",
  );

  const state: "ready" | "unauthorized" | "offline" | "none" =
    device.connected && device.mode === "adb"
      ? "ready"
      : device.adbState === "unauthorized"
        ? "unauthorized"
        : device.adbState === "offline"
          ? "offline"
          : "none";

  function restartLink() {
    push("Restarting ADB connection…", "system");
    run("adb", ["kill-server"]);
    setTimeout(() => run("adb", ["start-server"]), 400);
  }

  function Step({ n, text }: { n: number; text: string }) {
    return (
      <div className="flex gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-[11px] font-bold text-white">
          {n}
        </span>
        <span className="pt-px text-[12.5px] leading-snug text-[var(--color-ink)]">{text}</span>
      </div>
    );
  }

  const Head = ({ icon: Icon, title, tone }: { icon: typeof Usb; title: string; tone: string }) => (
    <div className="mb-3 flex items-center gap-2">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
        <Icon size={18} />
      </span>
      <span className="text-[15px] font-bold text-[var(--color-ink)]">{title}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* tools status */}
      <div
        className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] leading-snug ${
          coreMissing.length === 0
            ? "border border-emerald-100 bg-emerald-50 text-emerald-700"
            : "border border-rose-100 bg-rose-50 text-rose-600"
        }`}
      >
        <CheckCircle2 size={14} className="mt-[1px] shrink-0" />
        <span>{coreMissing.length === 0 ? t("setup.toolsOk") : t("setup.toolsMissing")}</span>
      </div>

      {state === "ready" ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-[14px] font-semibold text-emerald-700">
          <CheckCircle2 size={20} />
          {t("setup.ready")}
        </div>
      ) : (
        <>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-brand-600)]">
            {t("setup.title")}
          </div>

          {state === "unauthorized" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <Head icon={ShieldQuestion} title={t("setup.unauth.title")} tone="bg-amber-100 text-amber-600" />
              <div className="flex flex-col gap-2.5">
                <Step n={1} text={t("setup.unauth.1")} />
                <Step n={2} text={t("setup.unauth.2")} />
                <Step n={3} text={t("setup.unauth.3")} />
              </div>
              <Button size="block" variant="primary" className="mt-3" onClick={refresh} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                {t("setup.unauth.retry")}
              </Button>
            </div>
          )}

          {state === "offline" && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <Head icon={Plug} title={t("setup.offline.title")} tone="bg-[var(--color-surface-2)] text-[var(--color-ink-soft)]" />
              <div className="flex flex-col gap-2.5">
                <Step n={1} text={t("setup.offline.1")} />
                <Step n={2} text={t("setup.offline.2")} />
              </div>
              <Button size="block" className="mt-3" onClick={restartLink}>
                <RefreshCw size={14} /> {t("bottom.restart")}
              </Button>
            </div>
          )}

          {state === "none" && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <Head icon={Usb} title={t("setup.none.title")} tone="bg-sky-100 text-sky-600" />
              <div className="flex flex-col gap-2.5">
                <Step n={1} text={t("setup.none.1")} />
                <Step n={2} text={t("setup.none.2")} />
                <Step n={3} text={t("setup.none.3")} />
              </div>
            </div>
          )}

          {/* developer-mode walkthrough (always available while not ready) */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <Head icon={Smartphone} title={t("setup.devmode.title")} tone="bg-[var(--color-brand-50)] text-[var(--color-brand-600)]" />
            <p className="mb-3 text-[11.5px] leading-snug text-[var(--color-ink-soft)]">
              {t("setup.devmode.intro")}
            </p>
            <div className="flex flex-col gap-2.5">
              {(["setup.devmode.1", "setup.devmode.2", "setup.devmode.3", "setup.devmode.4", "setup.devmode.5"] as TKey[]).map(
                (k, i) => (
                  <Step key={k} n={i + 1} text={t(k)} />
                ),
              )}
            </div>
            <p className="mt-3 rounded-md bg-[var(--color-bg)] px-2.5 py-1.5 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
              💡 {t("setup.devmode.note")}
            </p>
          </div>

          <Button size="block" variant="primary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {t("setup.checkAgain")}
          </Button>
        </>
      )}
    </div>
  );
}
