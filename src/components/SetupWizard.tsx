import { useEffect, useState } from "react";
import {
  Usb,
  ShieldQuestion,
  Plug,
  CheckCircle2,
  Smartphone,
  Layers,
} from "lucide-react";
import { Button } from "./ui/Button";
import { useDevice } from "../state/device";
import { useTools2 } from "../state/tools";
import { useLog } from "../state/log";
import { useI18n, type TKey } from "../i18n";
import { listDevices, type AdbDeviceEntry } from "../lib/api";

type OsId = "hyperos" | "miui" | "oneui" | "coloros" | "oxygenos" | "funtouch" | "stock";

const OS_LIST: { id: OsId; labelKey: TKey }[] = [
  { id: "hyperos", labelKey: "setup.os.hyperos" },
  { id: "miui", labelKey: "setup.os.miui" },
  { id: "oneui", labelKey: "setup.os.oneui" },
  { id: "coloros", labelKey: "setup.os.coloros" },
  { id: "oxygenos", labelKey: "setup.os.oxygenos" },
  { id: "funtouch", labelKey: "setup.os.funtouch" },
  { id: "stock", labelKey: "setup.os.stock" },
];

/** Best-effort OS guess from ROM/brand strings (when a device is readable). */
function guessOs(rom: string, brand: string): OsId {
  const s = `${rom} ${brand}`.toLowerCase();
  if (s.includes("hyperos")) return "hyperos";
  if (s.includes("miui")) return "miui";
  if (s.includes("oneui") || s.includes("one ui") || s.includes("samsung")) return "oneui";
  if (s.includes("coloros") || s.includes("realme") || s.includes("oppo")) return "coloros";
  if (s.includes("oxygen") || s.includes("oneplus")) return "oxygenos";
  if (s.includes("funtouch") || s.includes("origin") || s.includes("vivo")) return "funtouch";
  return "stock";
}

/**
 * Connection guide shown in its OWN window (?view=setup). It polls device
 * state and closes itself the moment a single ready adb device appears, so the
 * main window stays fully usable underneath.
 */
export function SetupWizard({ inWindow = false }: { inWindow?: boolean }) {
  const { device, refresh, refreshing } = useDevice();
  const { tools } = useTools2();
  const { run, push } = useLog();
  const { t } = useI18n();
  const [list, setList] = useState<AdbDeviceEntry[]>([]);
  const [os, setOs] = useState<OsId | null>(null);

  // auto-pick OS from detected ROM (only until the user overrides it)
  const detectedOs = device.connected ? guessOs(device.rom, device.brand) : null;
  const activeOs: OsId = os ?? detectedOs ?? "stock";

  const coreMissing = tools.filter(
    (x) => ["adb", "fastboot"].includes(x.name) && x.source === "missing",
  );

  // keep a live list of all attached devices (for the multi-device case)
  useEffect(() => {
    let alive = true;
    const tick = () => listDevices().then((d) => alive && setList(d)).catch(() => {});
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const multi = list.length > 1;

  // when running as a standalone window, close once exactly one ready device
  useEffect(() => {
    if (!inWindow) return;
    if (device.connected && device.mode === "adb" && !multi) {
      (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        getCurrentWindow().close();
      })();
    }
  }, [inWindow, device.connected, device.mode, multi]);

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

      {/* MULTI-DEVICE takes priority — even if one is ready, 2+ is ambiguous */}
      {multi ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <Head icon={Layers} title={t("setup.multi.title")} tone="bg-amber-100 text-amber-600" />
          <p className="mb-2 text-[11.5px] leading-snug text-[var(--color-ink-soft)]">
            {t("setup.multi.intro")}
          </p>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {list.map((d, i) => (
              <div
                key={d.serial}
                className={`flex items-center gap-2 px-3 py-1.5 text-[11.5px] ${i % 2 ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}
              >
                <Smartphone size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--color-ink)]">
                    {d.model || d.serial}
                  </span>
                  <span className="block truncate font-mono text-[9.5px] text-[var(--color-ink-faint)]">
                    {d.serial}
                  </span>
                </span>
                <StateBadge state={d.state} t={t} />
              </div>
            ))}
          </div>
        </div>
      ) : state === "ready" ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-[14px] font-semibold text-emerald-700">
          <CheckCircle2 size={20} />
          {t("setup.ready")}
        </div>
      ) : (
        <>
          {state === "unauthorized" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <Head icon={ShieldQuestion} title={t("setup.unauth.title")} tone="bg-amber-100 text-amber-600" />
              <div className="flex flex-col gap-2.5">
                <Step n={1} text={t("setup.unauth.1")} />
                <Step n={2} text={t("setup.unauth.2")} />
                <Step n={3} text={t("setup.unauth.3")} />
              </div>
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
                {t("bottom.restart")}
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

          {/* per-OS developer-mode walkthrough with an OS picker */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <Head icon={Smartphone} title={t("setup.devmode.title")} tone="bg-[var(--color-brand-50)] text-[var(--color-brand-600)]" />

            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t("setup.os.title")}
            </div>
            <div className="mb-3 flex flex-wrap gap-1">
              {OS_LIST.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setOs(o.id)}
                  className={`no-drag rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors ${
                    activeOs === o.id
                      ? "bg-[var(--color-brand)] text-white"
                      : "bg-[var(--color-surface-2)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
            {detectedOs && os == null && (
              <p className="mb-2 text-[10.5px] text-emerald-600">
                {t("setup.os.auto", { name: t(("setup.os." + detectedOs) as TKey) })}
              </p>
            )}

            <div className="flex flex-col gap-2.5">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <Step key={n} n={n} text={t(`setup.g.${activeOs}.${n}` as TKey)} />
              ))}
            </div>
            <p className="mt-3 rounded-md bg-[var(--color-bg)] px-2.5 py-1.5 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
              💡 {t("setup.devmode.note")}
            </p>
          </div>
        </>
      )}

      {/* subtle auto-refresh hint instead of a jarring button; manual refresh
          still available but not the primary affordance */}
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-[var(--color-ink-faint)]">
        <span>{t("setup.autoHint")}</span>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="no-drag shrink-0 rounded-md px-2 py-1 text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-50"
        >
          {t("setup.checkAgain")}
        </button>
      </div>
    </div>
  );
}

function StateBadge({ state, t }: { state: string; t: (k: TKey) => string }) {
  const map: Record<string, { k: TKey; cls: string }> = {
    device: { k: "setup.multi.state.device", cls: "bg-emerald-50 text-emerald-600" },
    unauthorized: { k: "setup.multi.state.unauthorized", cls: "bg-amber-50 text-amber-700" },
    offline: { k: "setup.multi.state.offline", cls: "bg-slate-100 text-slate-500" },
  };
  const m = map[state] ?? { k: "setup.multi.state.offline" as TKey, cls: "bg-slate-100 text-slate-500" };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${m.cls}`}>
      {t(m.k)}
    </span>
  );
}
