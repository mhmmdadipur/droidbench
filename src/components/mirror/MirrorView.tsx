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
  Play,
  Square as StopIcon,
  Circle as RecDot,
  Save as SaveIcon,
  FolderOpen as FolderIcon,
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
  onMirrorDiag,
  onMirrorMeta,
  onMirrorStopped,
  type MirrorMeta,
} from "../../lib/mirrorApi";
import { cn } from "../../lib/utils";
import {
  loadMacros,
  saveMacros,
  newId,
  runMacro,
  type Step,
  type RunHandle,
} from "../../lib/autoclicker";

type Status = "starting" | "live" | "stopped" | "error";
type MirrorMode = "control" | "edit";

// Serializes mirror start/stop across React StrictMode's double-mount in dev
// (and any rapid re-mount): each effect queues its start behind the previous
// effect's teardown, so only one scrcpy session is ever live at a time and
// frames always reach the channel owned by the current mount.
let startChain: Promise<void> = Promise.resolve();

export function MirrorView({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [meta, setMeta] = useState<MirrorMeta | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const draggingRef = useRef(false);
  const latestFrameRef = useRef<{ width: number; height: number; rgba: Uint8Array } | null>(null);
  const [diag, setDiag] = useState<string>("");

  // ---- auto-clicker ----
  const [mode, setMode] = useState<MirrorMode>("control");
  const [steps, setSteps] = useState<Step[]>([]);
  const [recording, setRecording] = useState(false);
  const [runningStep, setRunningStep] = useState<number | null>(null);
  const [loops, setLoops] = useState(0); // 0 = infinite
  const runRef = useRef<RunHandle | null>(null);
  const recLastRef = useRef<number>(0);
  const editDownRef = useRef<{ nx: number; ny: number; moved: boolean } | null>(null);

  const isRunning = runningStep !== null;

  function addStep(s: Omit<Step, "id">) {
    setSteps((prev) => [...prev, { ...s, id: newId() }]);
  }
  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }
  function clearSteps() {
    setSteps([]);
  }
  function startRun() {
    if (steps.length === 0) return;
    runRef.current = runMacro(steps, loops, setRunningStep);
    runRef.current.done.then(() => {
      runRef.current = null;
      setRunningStep(null);
    });
  }
  function stopRun() {
    runRef.current?.stop();
    runRef.current = null;
    setRunningStep(null);
  }
  useEffect(() => () => runRef.current?.stop(), []);

  useEffect(() => {
    let unMeta: (() => void) | undefined;
    let unStopped: (() => void) | undefined;
    let unError: (() => void) | undefined;
    let unDiag: (() => void) | undefined;
    let cancelled = false;
    let started = false;

    const run = async () => {
      const { Channel } = await import("@tauri-apps/api/core");

      // React StrictMode mounts effects twice in dev; a stale previous session
      // may still be running on the device. Always stop first so the device's
      // scrcpy server + tunnel are torn down before we start a fresh one bound
      // to THIS effect's channel. Without this, two servers run and frames flow
      // into a channel whose onmessage was already cleaned up → blank screen.
      await mirrorStop().catch(() => {});
      if (cancelled) return;

      unMeta = await onMirrorMeta((m) => {
        if (!cancelled) {
          setMeta(m);
          setStatus("live");
        }
      });

      // Frames arrive as raw bytes over a Channel: [w:u32][h:u32][rgba...].
      // We only keep the latest; the rAF loop paints it (drops stale frames).
      const frameChan = new Channel<ArrayBuffer>();
      frameChan.onmessage = (buf) => {
        if (cancelled) return;
        const dv = new DataView(buf);
        const w = dv.getUint32(0, false);
        const h = dv.getUint32(4, false);
        latestFrameRef.current = { width: w, height: h, rgba: new Uint8Array(buf, 8) };
      };

      unStopped = await onMirrorStopped(() => {
        if (!cancelled) setStatus("stopped");
      });
      unError = await onMirrorError((msg) => {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(msg);
        }
      });
      unDiag = await onMirrorDiag((msg) => {
        if (!cancelled) setDiag(`rust: ${msg}`);
      });

      if (cancelled) return;
      try {
        started = true;
        await mirrorStart(frameChan, 1024, 8_000_000, 30);
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(String(e));
        }
      }
    };

    // serialize behind any in-flight session from a previous (strict-mode) mount
    startChain = startChain.then(run);

    return () => {
      cancelled = true;
      unMeta?.();
      unStopped?.();
      unError?.();
      unDiag?.();
      // only stop if we actually started; queue the stop on the chain so a
      // following mount's start waits for this teardown to finish.
      if (started) startChain = startChain.then(() => mirrorStop().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paint loop: render only the latest decoded frame on each animation frame.
  // Stale frames are discarded, so the mirror never builds up latency.
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const f = latestFrameRef.current;
      if (f) {
        latestFrameRef.current = null;
        const canvas = canvasRef.current;
        if (canvas) {
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
          if (ctx && img) {
            img.data.set(f.rgba);
            ctx.putImageData(img, 0, 0);
            setStatus((s) => (s === "live" ? s : "live"));
          }
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
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
    const { nx, ny } = norm(e);
    if (mode === "edit" && !recording) {
      // edit mode: start building a tap/swipe step (don't touch the device)
      e.currentTarget.setPointerCapture(e.pointerId);
      editDownRef.current = { nx, ny, moved: false };
      return;
    }
    // control mode (optionally recording): drive the device
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    editDownRef.current = { nx, ny, moved: false }; // reused to record swipe
    mirrorTouch("down", nx, ny).catch(() => {});
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { nx, ny } = norm(e);
    if (mode === "edit" && !recording) {
      if (editDownRef.current) editDownRef.current.moved = true;
      return;
    }
    if (!draggingRef.current) return;
    if (editDownRef.current) editDownRef.current.moved = true;
    mirrorTouch("move", nx, ny).catch(() => {});
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { nx, ny } = norm(e);
    const start = editDownRef.current;
    editDownRef.current = null;

    if (mode === "edit" && !recording) {
      // commit a step from the drag
      if (!start) return;
      const dist = Math.hypot(nx - start.nx, ny - start.ny);
      if (start.moved && dist > 0.03) {
        addStep({ kind: "swipe", nx: start.nx, ny: start.ny, nx2: nx, ny2: ny, delayMs: 300, repeat: 1 });
      } else {
        addStep({ kind: "tap", nx: start.nx, ny: start.ny, delayMs: 300, repeat: 1 });
      }
      return;
    }

    if (!draggingRef.current) return;
    draggingRef.current = false;
    mirrorTouch("up", nx, ny).catch(() => {});

    // if recording, capture this gesture as a step (with real timing gap)
    if (recording && start) {
      const now = Date.now();
      const gap = recLastRef.current ? now - recLastRef.current : 300;
      recLastRef.current = now;
      const dist = Math.hypot(nx - start.nx, ny - start.ny);
      if (start.moved && dist > 0.03) {
        addStep({ kind: "swipe", nx: start.nx, ny: start.ny, nx2: nx, ny2: ny, delayMs: Math.min(3000, gap), repeat: 1 });
      } else {
        addStep({ kind: "tap", nx: start.nx, ny: start.ny, delayMs: Math.min(3000, gap), repeat: 1 });
      }
    }
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
      {/* SCREEN AREA — center the device frame; the dark box shrink-wraps the
          phone (fit height + thin padding) instead of stretching full width. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        {status === "error" ? (
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-[var(--color-border)] bg-[#0b1220] p-4">
            <div className="max-w-sm text-center text-sm text-rose-300">
              <p className="mb-2 font-semibold">Mirror error</p>
              <p className="opacity-80">{errorMsg}</p>
            </div>
          </div>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#0b1220] p-3 shadow-sm">
            {/* object-contain: the screen fits whichever dimension is smaller
                (height when the window is wide, width when it's narrow),
                always keeping aspect — never stretched or clipped. */}
            <canvas
              ref={canvasRef}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onWheel={wheel}
              style={{ touchAction: "none", aspectRatio: String(aspect) }}
              className={cn(
                "max-h-full max-w-full rounded-xl bg-black object-contain shadow-lg ring-1",
                mode === "edit" ? "ring-2 ring-[var(--color-brand)] cursor-crosshair" : "ring-white/10",
              )}
            />
            {(mode === "edit" || isRunning) && steps.length > 0 && (
              <StepOverlay steps={steps} active={runningStep} aspect={aspect} />
            )}
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

          {diag && (
            <div className="mb-3 rounded-lg bg-amber-50 px-2.5 py-2 font-mono text-[10px] text-amber-700">
              {diag}
            </div>
          )}

          <Group title="Device">
            <Ctrl icon={Power} label="Power" hint="Tekan tombol power HP (kunci/buka layar)." onClick={() => mirrorKeycode(KEY.POWER)} />
            <Ctrl icon={RotateCcw} label="Restart" danger hint="Mulai ulang (restart) HP." onClick={() => mirrorKeycode(26)} />
            <Ctrl icon={Bell} label="Notifikasi" hint="Buka panel notifikasi (geser dari atas)." onClick={() => mirrorKeycode(KEY.NOTIFICATION)} />
            <Ctrl icon={LayoutGrid} label="Setelan Cepat" hint="Buka panel setelan cepat (WiFi, Bluetooth, dll)." onClick={() => mirrorOpen(INTENT.QUICK_SETTINGS)} />
            <Ctrl icon={EyeOff} label="Tutup Panel" hint="Tutup panel notifikasi/setelan yang terbuka." onClick={() => mirrorKeycode(4)} />
            <Ctrl icon={Settings} label="Setelan" hint="Buka aplikasi Setelan (Settings) HP." onClick={() => mirrorOpen(INTENT.SETTINGS)} />
            <Ctrl icon={Code2} label="Opsi Pengembang" hint="Buka Opsi Pengembang (Developer Options)." onClick={() => mirrorOpen(INTENT.DEV_OPTIONS)} />
            <Ctrl icon={Info} label="Tentang Ponsel" hint="Buka halaman 'Tentang ponsel' (info perangkat)." onClick={() => mirrorOpen(INTENT.ABOUT)} />
            <Ctrl icon={Trash2} label="Tutup Semua App" danger hint="Buka daftar aplikasi terbaru (untuk menutup semua)." onClick={() => mirrorKeycode(KEY.APP_SWITCH)} />
          </Group>

          <Group title="Clipboard (Salin-Tempel)">
            <Ctrl icon={ArrowDownToLine} label="PC → HP" hint="Kirim teks yang disalin di komputer ke clipboard HP." onClick={pcToPhone} />
            <Ctrl icon={ArrowUpFromLine} label="HP → PC" hint="Ambil teks dari clipboard HP ke komputer." onClick={phoneToPc} />
          </Group>

          <Group title="File">
            <Ctrl icon={Camera} label="Screenshot" hint="Ambil tangkapan layar HP & simpan ke folder di komputer." onClick={screenshot} />
            <Ctrl icon={Upload} label="Kirim File" hint="Kirim file dari komputer ke folder Download HP." onClick={pushFile} />
          </Group>

          <AutoClickerPanel
            mode={mode}
            setMode={setMode}
            steps={steps}
            recording={recording}
            setRecording={(v) => {
              setRecording(v);
              recLastRef.current = 0;
            }}
            isRunning={isRunning}
            loops={loops}
            setLoops={setLoops}
            onStart={startRun}
            onStop={stopRun}
            onRemove={removeStep}
            onClear={clearSteps}
            onUpdate={(id, patch) =>
              setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
            }
            setSteps={setSteps}
          />
        </div>

        {/* Android nav bar */}
        <div className="flex items-center justify-center gap-10 border-t border-[var(--color-border)] py-3">
          <NavBtn icon={Square} label="Aplikasi terbaru (Recents)" onClick={() => mirrorKeycode(KEY.APP_SWITCH)} />
          <NavBtn icon={Circle} label="Layar utama (Home)" onClick={() => mirrorKeycode(KEY.HOME)} />
          <NavBtn icon={ChevronLeft} label="Kembali (Back)" onClick={() => mirrorBack()} />
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
  hint,
}: {
  icon: typeof Power;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <button
      onClick={() => onClick()}
      title={hint ?? label}
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

/** Numbered markers drawn over the canvas (normalized coords → %).
 * The inner box matches the contained canvas (same aspect + max sizing,
 * centered) so markers land exactly on the device pixels. */
function StepOverlay({ steps, active, aspect }: { steps: Step[]; active: number | null; aspect: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="relative max-h-full max-w-full"
        style={{ aspectRatio: String(aspect), height: "100%" }}
      >
        {steps.map((s, i) => (
          <div key={s.id}>
            {s.kind === "swipe" && s.nx2 != null && s.ny2 != null && (
              <svg className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
                <line
                  x1={`${s.nx * 100}%`}
                  y1={`${s.ny * 100}%`}
                  x2={`${s.nx2 * 100}%`}
                  y2={`${s.ny2 * 100}%`}
                  stroke={i === active ? "#f59e0b" : "#14b8a6"}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              </svg>
            )}
            <Marker n={i + 1} nx={s.nx} ny={s.ny} activeNow={i === active} />
            {s.kind === "swipe" && s.nx2 != null && s.ny2 != null && (
              <Marker n={i + 1} nx={s.nx2} ny={s.ny2} activeNow={i === active} ghost />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Marker({ n, nx, ny, activeNow, ghost }: { n: number; nx: number; ny: number; activeNow: boolean; ghost?: boolean }) {
  return (
    <div
      className={cn(
        "absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold shadow ring-2 ring-white",
        activeNow ? "bg-amber-400 text-black" : ghost ? "bg-teal-400/70 text-black" : "bg-teal-500 text-white",
      )}
      style={{ left: `${nx * 100}%`, top: `${ny * 100}%` }}
    >
      {n}
    </div>
  );
}

interface PanelProps {
  mode: MirrorMode;
  setMode: (m: MirrorMode) => void;
  steps: Step[];
  recording: boolean;
  setRecording: (v: boolean) => void;
  isRunning: boolean;
  loops: number;
  setLoops: (n: number) => void;
  onStart: () => void;
  onStop: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onUpdate: (id: string, patch: Partial<Step>) => void;
  setSteps: (s: Step[]) => void;
}

function AutoClickerPanel(p: PanelProps) {
  const [savedName, setSavedName] = useState("");

  function saveCurrent() {
    const name = savedName.trim() || `macro-${Date.now().toString().slice(-5)}`;
    const list = loadMacros().filter((m) => m.name !== name);
    list.push({ name, steps: p.steps });
    saveMacros(list);
    setSavedName("");
  }
  function loadFirst() {
    const list = loadMacros();
    if (list.length > 0) p.setSteps(list[list.length - 1].steps);
  }

  return (
    <Group title="Auto-Clicker">
      {/* mode toggle */}
      <div className="flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
        <button
          onClick={() => p.setMode("control")}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[11px] font-medium",
            p.mode === "control" ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)]",
          )}
          title="Klik di layar = kontrol HP langsung"
        >
          Kontrol
        </button>
        <button
          onClick={() => p.setMode("edit")}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[11px] font-medium",
            p.mode === "edit" ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)]",
          )}
          title="Klik di layar = tambah titik/swipe bernomor (tidak menyentuh HP)"
        >
          Edit Titik
        </button>
      </div>
      <p className="px-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">
        {p.mode === "edit"
          ? "Klik layar untuk menambah titik, geser untuk swipe. Titik muncul bernomor."
          : "Mode kontrol: klik mengendalikan HP. Aktifkan Rekam untuk mencatat klikmu."}
      </p>

      {/* record + run */}
      <div className="flex gap-1.5">
        {!p.recording ? (
          <button
            onClick={() => p.setRecording(true)}
            disabled={p.isRunning || p.mode === "edit"}
            className="no-drag flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] font-medium text-[var(--color-ink)] hover:border-rose-300 disabled:opacity-40"
            title="Rekam: setiap klik/swipe-mu di mode Kontrol dicatat jadi langkah bernomor."
          >
            <RecDot size={12} className="text-rose-500" /> Rekam
          </button>
        ) : (
          <button
            onClick={() => p.setRecording(false)}
            className="no-drag flex flex-1 items-center justify-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-600"
          >
            <StopIcon size={12} /> Stop Rekam
          </button>
        )}
        {!p.isRunning ? (
          <button
            onClick={p.onStart}
            disabled={p.steps.length === 0 || p.recording}
            className="no-drag flex flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--color-brand)] px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--color-brand-600)] disabled:opacity-40"
            title="Jalankan urutan titik/swipe."
          >
            <Play size={12} /> Jalankan
          </button>
        ) : (
          <button
            onClick={p.onStop}
            className="no-drag flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500 px-2 py-1.5 text-[11px] font-semibold text-white"
          >
            <StopIcon size={12} /> Stop
          </button>
        )}
      </div>

      {/* loop count */}
      <label className="flex items-center justify-between gap-2 px-1 text-[11px] text-[var(--color-ink-soft)]">
        <span title="Berapa kali seluruh urutan diulang. 0 = tak terbatas (sampai Stop).">Ulangi (0 = ∞)</span>
        <input
          type="number"
          min={0}
          value={p.loops}
          onChange={(e) => p.setLoops(Math.max(0, Number(e.target.value) || 0))}
          className="no-drag w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-right text-[11px] outline-none focus:border-[var(--color-brand)]"
        />
      </label>

      {/* step list */}
      <div className="max-h-[180px] overflow-auto rounded-lg border border-[var(--color-border)]">
        {p.steps.length === 0 ? (
          <div className="px-2.5 py-2 text-[10.5px] text-[var(--color-ink-faint)]">
            Belum ada langkah. Pakai mode Edit atau Rekam.
          </div>
        ) : (
          p.steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1.5 text-[11px] last:border-0">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-500 text-[9px] font-bold text-white">
                {i + 1}
              </span>
              <span className="w-10 shrink-0 text-[var(--color-ink-soft)]">{s.kind === "tap" ? "Tap" : "Swipe"}</span>
              <input
                type="number"
                min={0}
                value={s.delayMs}
                onChange={(e) => p.onUpdate(s.id, { delayMs: Math.max(0, Number(e.target.value) || 0) })}
                title="Jeda setelah langkah ini (ms)"
                className="no-drag w-14 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-right outline-none"
              />
              <span className="text-[9px] text-[var(--color-ink-faint)]">ms</span>
              <input
                type="number"
                min={1}
                value={s.repeat}
                onChange={(e) => p.onUpdate(s.id, { repeat: Math.max(1, Number(e.target.value) || 1) })}
                title="Berapa kali langkah ini diulang"
                className="no-drag w-10 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-right outline-none"
              />
              <span className="text-[9px] text-[var(--color-ink-faint)]">×</span>
              <button onClick={() => p.onRemove(s.id)} className="no-drag ml-auto text-[var(--color-ink-faint)] hover:text-rose-500" title="Hapus langkah">
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* save / load / clear */}
      <div className="flex items-center gap-1.5">
        <input
          value={savedName}
          onChange={(e) => setSavedName(e.target.value)}
          placeholder="Nama makro"
          className="no-drag min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] outline-none focus:border-[var(--color-brand)]"
        />
        <button onClick={saveCurrent} disabled={p.steps.length === 0} className="no-drag rounded-md border border-[var(--color-border)] p-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)] disabled:opacity-40" title="Simpan makro">
          <SaveIcon size={13} />
        </button>
        <button onClick={loadFirst} className="no-drag rounded-md border border-[var(--color-border)] p-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)]" title="Muat makro terakhir tersimpan">
          <FolderIcon size={13} />
        </button>
        <button onClick={p.onClear} disabled={p.steps.length === 0} className="no-drag rounded-md border border-[var(--color-border)] p-1.5 text-[var(--color-ink-faint)] hover:text-rose-500 disabled:opacity-40" title="Hapus semua langkah">
          <Trash2 size={13} />
        </button>
      </div>
    </Group>
  );
}
