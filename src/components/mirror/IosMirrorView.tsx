import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useDevice } from "../../state/device";
import { useI18n } from "../../i18n";

type Status = "starting" | "live" | "stopped" | "error";

/**
 * Read-only iOS screen mirror. go-ios streams MJPEG over USB; the Rust side
 * forwards each raw JPEG frame over a Channel. We paint the latest frame to an
 * <img> via a Blob URL, dropping stale frames so latency never builds up.
 */
export function IosMirrorView({ onClose }: { onClose: () => void }) {
  const { device } = useDevice();
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  // keep only the latest frame; paint on rAF and revoke the previous blob URL
  const latestRef = useRef<ArrayBuffer | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unError: (() => void) | undefined;
    let raf = 0;

    const paint = () => {
      const f = latestRef.current;
      if (f && imgRef.current) {
        latestRef.current = null;
        const blob = new Blob([f], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const prev = urlRef.current;
        urlRef.current = url;
        imgRef.current.src = url;
        if (prev) URL.revokeObjectURL(prev);
        if (status !== "live") setStatus("live");
      }
      raf = requestAnimationFrame(paint);
    };

    (async () => {
      const { Channel } = await import("@tauri-apps/api/core");
      const { iosMirrorStart } = await import("../../lib/api");

      unError = await listen<string>("ios-mirror-error", (e) => {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(String(e.payload));
        }
      });

      const chan = new Channel<ArrayBuffer>();
      chan.onmessage = (buf) => {
        if (cancelled) return;
        latestRef.current = buf;
      };

      try {
        await iosMirrorStart(device.serial, chan);
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(String(e));
        }
      }
    })();

    raf = requestAnimationFrame(paint);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      unError?.();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      import("../../lib/api").then((m) => m.iosMirrorStop().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[12px] font-semibold text-[var(--color-ink)]">
          {t("ios.mirror.title")}
        </span>
        <StatusPill status={status} t={t} />
        <button
          onClick={onClose}
          title={t("common.close")}
          className="no-drag ml-auto flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-500 hover:bg-rose-100"
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#0b1220] p-3">
        {status === "error" ? (
          <div className="max-w-sm text-center text-sm text-rose-300">
            <p className="mb-2 font-semibold">{t("ios.mirror.errTitle")}</p>
            <p className="opacity-80">{errorMsg}</p>
            <p className="mt-2 text-[11px] opacity-70">{t("ios.mirror.errHint")}</p>
          </div>
        ) : (
          <>
            {/* read-only: no pointer handlers */}
            <img
              ref={imgRef}
              alt="iOS screen"
              className="max-h-full max-w-full rounded-lg object-contain shadow-lg"
            />
            {status === "starting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
                <Loader2 className="animate-spin" size={28} />
                <span className="text-sm">{t("ios.mirror.starting")}</span>
              </div>
            )}
          </>
        )}
      </div>
      <p className="px-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">
        {t("ios.mirror.readonlyNote")}
      </p>
    </div>
  );
}

function StatusPill({ status, t }: { status: Status; t: (k: never) => string }) {
  const map: Record<Status, { c: string; k: string }> = {
    starting: { c: "bg-amber-50 text-amber-600", k: "STARTING" },
    live: { c: "bg-emerald-50 text-emerald-600", k: "LIVE" },
    stopped: { c: "bg-slate-100 text-slate-500", k: "STOPPED" },
    error: { c: "bg-rose-50 text-rose-500", k: "ERROR" },
  };
  void t;
  const m = map[status];
  return <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${m.c}`}>{m.k}</span>;
}
