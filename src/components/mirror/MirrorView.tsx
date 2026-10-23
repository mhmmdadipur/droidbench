import { useEffect, useRef, useState } from "react";
import {
  Power,
  RotateCcw,
  ChevronLeft,
  Square,
  Circle,
  Bell,
  LayoutGrid,
  EyeOff,
  Settings,
  Code2,
  Info,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  Upload,
  X,
  Loader2,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  INTENT,
  KEY,
  mirrorBack,
  mirrorGetClipboard,
  mirrorKeycode,
  mirrorOpen,
  mirrorPushFile,
  mirrorScreenshot,
  mirrorScroll,
  mirrorSetClipboard,
  mirrorSetSize,
  mirrorStart,
  mirrorStop,
  mirrorTouch,
  onMirrorError,
  onMirrorFrame,
  onMirrorMeta,
  onMirrorStopped,
  type MirrorMeta,
} from "../../lib/mirrorApi";
import { base64ToBytes } from "../../lib/decoder";
import { cn } from "../../lib/utils";

type Status = "starting" | "live" | "stopped" | "error";

export function MirrorView({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [meta, setMeta] = useState<MirrorMeta | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    let unMeta: (() => void) | undefined;
    let unFrame: (() => void) | undefined;
    let unStopped: (() => void) | undefined;
    let unError: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      unMeta = await onMirrorMeta((m) => {
        if (!cancelled) {
          setMeta(m);
          setStatus("live");
        }
      });
      unFrame = await onMirrorFrame((f) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (canvas.width !== f.width || canvas.height !== f.height || !imageDataRef.current) {
          canvas.width = f.width;
          canvas.height = f.height;
          ctxRef.current = canvas.getContext("2d");
          imageDataRef.current = ctxRef.current?.createImageData(f.width, f.height) ?? null;
          setFrameSize({ w: f.width, h: f.height });
          mirrorSetSize(f.width, f.height).catch(() => {});
        }
        const ctx = ctxRef.current;
        const img = imageDataRef.current;
        if (!ctx || !img) return;
        img.data.set(base64ToBytes(f.rgba_b64));
        ctx.putImageData(img, 0, 0);
        if (status !== "live") setStatus("live");
      });
      unStopped = await onMirrorStopped(() => {
        if (!cancelled) setStatus("stopped");
      });
      unError = await onMirrorError((msg) => {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(msg);
        }
      });

      try {
        await mirrorStart(1024, 8_000_000);
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      unMeta?.();
      unFrame?.();
      unStopped?.();
      unError?.();
      mirrorStop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAndClose() {
    mirrorStop().catch(() => {});
    onClose();
  }

  // ---- input ----
  function norm(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      nx: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      ny: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (status !== "live") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const { nx, ny } = norm(e);
    mirrorTouch("down", nx, ny).catch(() => {});
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    const { nx, ny } = norm(e);
    mirrorTouch("move", nx, ny).catch(() => {});
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const { nx, ny } = norm(e);
    mirrorTouch("up", nx, ny).catch(() => {});
  };
  const wheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    mirrorScroll(nx, ny, 0, e.deltaY > 0 ? -1 : 1).catch(() => {});
  };

  // ---- control actions ----
  async function screenshot() {
    const file = await save({
      title: "Save screenshot",
      defaultPath: `droidbench_shot.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    // save() returns a file path; use its directory
    if (typeof file !== "string") return;
    const dir = file.replace(/[/\\][^/\\]*$/, "");
    mirrorScreenshot(dir).catch(() => {});
  }
  async function pushFile() {
    const f = await open({ multiple: false, title: "Push file to device" });
    if (typeof f === "string") mirrorPushFile(f).catch(() => {});
  }
  async function pcToPhone() {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (text) mirrorSetClipboard(text).catch(() => {});
  }
  async function phoneToPc() {
    const text = await mirrorGetClipboard().catch(() => "");
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  const aspect = frameSize ? frameSize.w / frameSize.h : meta && meta.width ? meta.width / meta.height : 9 / 19.5;

  return (
    <div className="flex h-full gap-3">
      {/* SCREEN — dark-blue bg, padding, canvas fits device aspect */}
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[#0b1220] p-4 shadow-sm">
        {status === "error" ? (
          <div className="max-w-sm text-center text-sm text-rose-300">
            <p className="mb-2 font-semibold">Mirror error</p>
            <p className="opacity-80">{errorMsg}</p>
          </div>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center">
            <canvas
              ref={canvasRef}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onWheel={wheel}
              style={{ aspectRatio: String(aspect), touchAction: "none" }}
              className="max-h-full max-w-full rounded-xl bg-black object-contain shadow-lg ring-1 ring-white/10"
            />
            {status === "starting" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
                <Loader2 className="animate-spin" size={28} />
                <span className="text-sm">Starting mirror…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CONTROLS */}
      <div className="flex w-[240px] shrink-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">Controls</span>
          <StatusPill status={status} />
          <button
            onClick={stopAndClose}
            title="Stop mirror"
            className="no-drag ml-auto flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-500 hover:bg-rose-100"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {meta && frameSize && (
            <div className="mb-3 rounded-lg bg-[var(--color-bg)] px-2.5 py-2 text-[11px] text-[var(--color-ink-soft)]">
              {meta.codec.toUpperCase()} · {frameSize.w}×{frameSize.h}
            </div>
          )}

          <Group title="Device">
            <Ctrl icon={Power} label="Power" onClick={() => mirrorKeycode(KEY.POWER)} />
            <Ctrl icon={RotateCcw} label="Restart" danger onClick={() => mirrorKeycode(26)} />
            <Ctrl icon={Bell} label="Notifications" onClick={() => mirrorKeycode(KEY.NOTIFICATION)} />
            <Ctrl icon={LayoutGrid} label="Quick Settings" onClick={() => mirrorOpen(INTENT.QUICK_SETTINGS)} />
            <Ctrl icon={EyeOff} label="Hide Panels" onClick={() => mirrorKeycode(4)} />
            <Ctrl icon={Settings} label="Settings" onClick={() => mirrorOpen(INTENT.SETTINGS)} />
            <Ctrl icon={Code2} label="Developer Options" onClick={() => mirrorOpen(INTENT.DEV_OPTIONS)} />
            <Ctrl icon={Info} label="About Phone" onClick={() => mirrorOpen(INTENT.ABOUT)} />
            <Ctrl icon={Trash2} label="Clear Recents" danger onClick={() => mirrorKeycode(KEY.APP_SWITCH)} />
          </Group>

          <Group title="Clipboard">
            <Ctrl icon={ArrowDownToLine} label="PC → Phone" onClick={pcToPhone} />
            <Ctrl icon={ArrowUpFromLine} label="Phone → PC" onClick={phoneToPc} />
          </Group>

          <Group title="Files">
            <Ctrl icon={Camera} label="Screenshot" onClick={screenshot} />
            <Ctrl icon={Upload} label="Push File" onClick={pushFile} />
          </Group>
        </div>

        {/* Android nav bar */}
        <div className="flex items-center justify-center gap-10 border-t border-[var(--color-border)] py-3">
          <NavBtn icon={Square} label="Recents" onClick={() => mirrorKeycode(KEY.APP_SWITCH)} />
          <NavBtn icon={Circle} label="Home" onClick={() => mirrorKeycode(KEY.HOME)} />
          <NavBtn icon={ChevronLeft} label="Back" onClick={() => mirrorBack()} />
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { c: string; t: string }> = {
    starting: { c: "bg-amber-50 text-amber-600", t: "STARTING" },
    live: { c: "bg-emerald-50 text-emerald-600", t: "LIVE" },
    stopped: { c: "bg-slate-100 text-slate-500", t: "STOPPED" },
    error: { c: "bg-rose-50 text-rose-500", t: "ERROR" },
  };
  const { c, t } = map[status];
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold", c)}>{t}</span>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Ctrl({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Power;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={() => onClick()}
      className={cn(
        "no-drag flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        danger
          ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)]",
      )}
    >
      <Icon size={15} className={danger ? "" : "text-[var(--color-brand-600)]"} />
      {label}
    </button>
  );
}

function NavBtn({ icon: Icon, label, onClick }: { icon: typeof Square; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="no-drag flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
    >
      <Icon size={18} />
    </button>
  );
}
