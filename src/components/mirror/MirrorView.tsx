import { useEffect, useMemo, useRef, useState } from "react";
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
  Volume2,
  Plus,
  Minus,
  VolumeX,
  RotateCw,
  Monitor,
  MonitorOff,
  Video,
  Copy,
  Keyboard,
  KeyboardOff,
  ScanSearch,
} from "lucide-react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  INTENT,
  KEY,
  mirrorBack,
  mirrorClipboardFromPhone,
  mirrorClipboardToPhone,
  mirrorDisplayPower,
  mirrorKeycode,
  mirrorOpen,
  mirrorPanel,
  mirrorPasteText,
  mirrorPushFile,
  mirrorReboot,
  mirrorRecordStart,
  mirrorRecordStop,
  mirrorRotate,
  mirrorScreenshot,
  mirrorScroll,
  mirrorSetSize,
  mirrorStart,
  mirrorStop,
  mirrorText,
  mirrorUiDump,
  mirrorUhidCreate,
  mirrorUhidDestroy,
  mirrorUhidInput,
  pcClipboardSet,
  pcClipboardSetImage,
  mirrorTouch,
  onMirrorAudio,
  onMirrorClipboard,
  onMirrorRecordError,
  onMirrorError,
  onMirrorHint,
  onMirrorDiag,
  onMirrorMeta,
  onMirrorStopped,
  type MirrorMeta,
  type MirrorSource,
} from "../../lib/mirrorApi";
import { AKEY, classifyKey, hidReport, isDirectlyTypable, isHidKey, isHidModifier, isMac } from "../../lib/mirrorKeys";
import { analyze, hitTest, parseUiDump, type UiTree } from "../../lib/uiInspector";
import type { Snippet } from "../../lib/snippets";
import { EXAMPLE_SCRIPT, appendLine, recordText, tapTarget, targetFor } from "../../lib/uiTest";
import { useDevice } from "../../state/device";
import { PcmPlayer } from "../../lib/mirrorAudio";
import { installXapk, runCapture } from "../../lib/api";
import { cn } from "../../lib/utils";
import { HelpTip } from "../ui/HelpTip";
import { InspectorOverlay, InspectorPanel } from "./Inspector";
import { SnippetsPanel } from "./Snippets";
import { UiTestPanel } from "./UiTestPanel";
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

// Video quality presets. Frames are decoded to RGBA and sent to the webview, so a
// bigger size costs real CPU / IPC bandwidth: "sharp" is the practical ceiling.
type Quality = "low" | "balanced" | "sharp";
const QUALITY: Record<Quality, { maxSize: number; bitrate: number; fps: number; label: string; hint: string }> = {
  low: { maxSize: 720, bitrate: 4_000_000, fps: 30, label: "Hemat", hint: "720 px / 4 Mbps — paling ringan, cocok untuk laptop lambat." },
  balanced: { maxSize: 1024, bitrate: 8_000_000, fps: 30, label: "Seimbang", hint: "1024 px / 8 Mbps — pilihan bawaan." },
  sharp: { maxSize: 1280, bitrate: 12_000_000, fps: 30, label: "Tajam", hint: "1280 px / 12 Mbps — lebih jelas, butuh CPU lebih besar." },
};
const LS_QUALITY = "droidbench.mirror.quality";
const LS_AUDIO = "droidbench.mirror.audio";
const LS_UHID = "droidbench.mirror.uhid";
const LS_SHOT_DIR = "droidbench.mirror.shotDir";

/** "…/Downloads" — the last folders of a path, so a long path still shows what matters. */
function shortPath(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
}
function loadQuality(): Quality {
  try {
    const v = localStorage.getItem(LS_QUALITY);
    if (v === "low" || v === "balanced" || v === "sharp") return v;
  } catch {
    /* ignore */
  }
  return "balanced";
}

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

  // ---- mirror settings / extra features ----
  const [quality, setQuality] = useState<Quality>(loadQuality);
  const [audioOn, setAudioOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_AUDIO) === "1";
    } catch {
      return false;
    }
  });
  const [audioState, setAudioState] = useState<"off" | "on" | "unsupported" | "error">("off");
  const playerRef = useRef<PcmPlayer | null>(null);
  const [displayOff, setDisplayOff] = useState(false);
  // Screenshots save straight to a folder (default: the OS Downloads folder) with no dialog;
  // the folder can be changed under the button and is remembered.
  const [shotDir, setShotDir] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_SHOT_DIR) ?? "";
    } catch {
      return "";
    }
  });
  const [defaultShotDir, setDefaultShotDir] = useState("");
  const effectiveShotDir = shotDir || defaultShotDir;
  useEffect(() => {
    downloadDir()
      .then(setDefaultShotDir)
      .catch(() => {});
  }, []);
  const [screenRec, setScreenRec] = useState(false); // device screen recording (not the macro recorder)
  const [recSecs, setRecSecs] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const pinchRef = useRef(false); // Shift+drag = two-finger pinch
  // Physical-keyboard mode (scrcpy -K): the laptop keyboard becomes a real HID keyboard on the phone.
  const [uhidOn, setUhidOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_UHID) === "1";
    } catch {
      return false;
    }
  });
  const heldRef = useRef<Set<string>>(new Set()); // physical keys currently held (KeyboardEvent.code)
  const hidChain = useRef<Promise<void>>(Promise.resolve()); // keeps reports in order

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

  // ---- keyboard / clipboard ----
  // A hidden <textarea> holds keyboard focus while the mirror is live in
  // Control mode. Text arrives via its `input` event (any layout, accents, IME).
  // Plain ASCII is injected as key events; anything else (accents, CJK, emoji,
  // newlines) is pasted through the phone clipboard, because the scrcpy server
  // skips characters that have no key mapping. Special keys and Ctrl/Cmd
  // shortcuts are mapped in lib/mirrorKeys.ts.
  const kbRef = useRef<HTMLTextAreaElement>(null);
  const lastPasteAt = useRef(0);
  const lastCopyAt = useRef(0);
  const lastClipEventAt = useRef(0); // when the phone last pushed clipboard text to us
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  // ---- UI inspector (semantic ids) ----
  const [inspecting, setInspecting] = useState(false);
  const [uiTree, setUiTree] = useState<UiTree | null>(null);
  const [uiBusy, setUiBusy] = useState(false);
  const [uiStale, setUiStale] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const analysis = useMemo(() => (uiTree ? analyze(uiTree) : null), [uiTree]);
  const textChain = useRef<Promise<void>>(Promise.resolve()); // keeps typed text in order
  // the Tes UI script lives here so the inspector and the recorder can add lines to it
  const [testScript, setTestScript] = useState(EXAMPLE_SCRIPT);
  const [uiRecording, setUiRecording] = useState(false);
  const uiRefreshTimer = useRef<number | undefined>(undefined);
  // set when the server reports something with a known fix (e.g. input blocked on Xiaomi)
  const [hint, setHint] = useState<string | null>(null);
  const { device } = useDevice();
  const xiaomiFamily = /xiaomi|redmi|poco/i.test(`${device.brand} ${device.model}`);
  // what is mirrored: the screen, or a camera (view only: there is nothing to tap or type into)
  const [source, setSource] = useState<MirrorSource>("screen");
  const isScreen = source === "screen";
  const kbActive = status === "live" && mode === "control" && !inspecting && isScreen;

  function showToast(msg: string) {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2500);
  }
  function focusKb() {
    kbRef.current?.focus({ preventScroll: true });
  }
  async function sendClipboardToPhone(paste: boolean) {
    try {
      const n = await mirrorClipboardToPhone(paste);
      showToast(n > 0 ? `Clipboard PC dikirim ke HP (${n} karakter)` : "Clipboard PC kosong");
    } catch (e) {
      showToast(`Gagal kirim clipboard: ${String(e)}`);
    }
  }
  // Paste/copy can reach us twice on some platforms (keydown AND the native
  // paste/copy event, e.g. via the macOS Edit menu); dedupe within 400ms.
  function doPaste() {
    const now = Date.now();
    if (now - lastPasteAt.current < 400) return;
    lastPasteAt.current = now;
    void sendClipboardToPhone(true);
  }
  function doCopy(cut: boolean) {
    const now = Date.now();
    if (now - lastCopyAt.current < 400) return;
    lastCopyAt.current = now;
    // The phone only reports its clipboard when it CHANGES (scrcpy autosync), so with
    // no text selected nothing comes back. Say so instead of failing silently.
    mirrorClipboardFromPhone(cut ? 2 : 1).catch((e) => showToast(`Gagal menyalin: ${String(e)}`));
    window.setTimeout(() => {
      if (lastClipEventAt.current < now) {
        showToast("Tidak ada teks yang disalin. Pilih teks di HP dulu (tekan lama pada teks), lalu Ctrl/Cmd+C.");
      }
    }, 1500);
  }
  // ---- physical keyboard mode (scrcpy -K / UHID) ----
  // Reports are queued on one promise chain so they reach the phone in the order the
  // keys were pressed (and so a clipboard sync can precede a Ctrl+V report).
  function queueHid(report: number[], before?: () => Promise<unknown>, gapMs = 0) {
    hidChain.current = hidChain.current.then(async () => {
      try {
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
        if (before) await before();
        await mirrorUhidInput(report);
      } catch {
        /* the session may already be gone */
      }
    });
  }
  const hidSnapshot = () => hidReport(heldRef.current, isMac());
  function releaseAllKeys() {
    if (heldRef.current.size === 0) return;
    heldRef.current.clear();
    queueHid(hidSnapshot());
  }
  /** Returns true when the key was handled as a physical key. */
  function onUhidKey(e: React.KeyboardEvent<HTMLTextAreaElement>, down: boolean): boolean {
    const code = e.code;
    if (!isHidKey(code)) return false; // unknown key: fall back to the text path
    e.preventDefault();
    const mac = isMac();
    if (down) {
      if (e.repeat) return true; // Android makes its own auto-repeat for a held key
      const mod = e.ctrlKey || e.metaKey;
      heldRef.current.add(code);
      const report = hidSnapshot();
      if (mod && code === "KeyV") {
        // like scrcpy: hand the PC clipboard to the phone first, then send Ctrl+V
        lastPasteAt.current = Date.now();
        queueHid(report, () => mirrorClipboardToPhone(false));
      } else {
        if (mod && (code === "KeyC" || code === "KeyX")) lastCopyAt.current = Date.now();
        queueHid(report);
      }
      // macOS never delivers the key-up of a key released after Cmd, so make Cmd+key a tap
      if (mac && e.metaKey && !isHidModifier(code)) {
        heldRef.current.delete(code);
        queueHid(hidSnapshot(), undefined, 30);
      }
    } else {
      heldRef.current.delete(code);
      if (mac && (code === "MetaLeft" || code === "MetaRight")) {
        // Cmd released: drop any non-modifier key whose key-up macOS swallowed
        for (const k of [...heldRef.current]) if (!isHidModifier(k)) heldRef.current.delete(k);
      }
      queueHid(hidSnapshot());
    }
    return true;
  }
  function toggleUhid() {
    const next = !uhidOn;
    try {
      localStorage.setItem(LS_UHID, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!next) releaseAllKeys(); // lift held keys before the virtual keyboard disappears
    setUhidOn(next);
    showToast(next ? "Keyboard laptop dipakai sebagai keyboard fisik HP" : "Keyboard fisik dimatikan");
  }
  // Create the virtual keyboard once the mirror is live; remove it when turned off
  // or when the session ends (the phone's own keyboard comes back).
  useEffect(() => {
    if (!uhidOn || status !== "live") return;
    mirrorUhidCreate().catch((e) => showToast(`Keyboard fisik gagal dibuat: ${String(e)}`));
    const onWinBlur = () => releaseAllKeys();
    window.addEventListener("blur", onWinBlur);
    return () => {
      window.removeEventListener("blur", onWinBlur);
      heldRef.current.clear();
      hidChain.current = hidChain.current.then(() => mirrorUhidDestroy().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhidOn, status]);

  const onKbKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!kbActive || e.nativeEvent.isComposing) return;
    if (uhidOn && onUhidKey(e, true)) return;
    const a = classifyKey(e);
    switch (a.kind) {
      case "none":
        return; // printable: becomes text via the input event
      case "keycode":
        e.preventDefault();
        mirrorKeycode(a.keycode, a.meta).catch(() => {});
        if (uiRecording && a.keycode === AKEY.ENTER) {
          setTestScript((t) => appendLine(t, "tekan enter"));
          scheduleUiRefresh();
        }
        return;
      case "back":
        e.preventDefault();
        mirrorBack().catch(() => {});
        return;
      case "copy":
        e.preventDefault();
        doCopy(a.cut);
        return;
      case "paste":
        e.preventDefault();
        doPaste();
        return;
    }
  };
  const onKbKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (uhidOn && kbActive) onUhidKey(e, false);
  };
  /** Queue a job so text typed or sent in quick succession reaches the phone in order. */
  function queuePhoneText(job: () => Promise<unknown>) {
    textChain.current = textChain.current.then(async () => {
      try {
        await job();
      } catch (e) {
        showToast(`Gagal mengirim teks: ${String(e)}`);
      }
    });
  }
  function sendText(text: string) {
    if (uiRecording) setTestScript((s) => recordText(s, text));
    queuePhoneText(() => (isDirectlyTypable(text) ? mirrorText(text) : mirrorPasteText(text)));
  }
  function sendSnippet(s: Snippet) {
    if (status !== "live") {
      showToast("Mirror belum aktif");
      return;
    }
    sendText(s.text);
    if (s.enter) {
      queuePhoneText(() => mirrorKeycode(AKEY.ENTER));
      if (uiRecording) setTestScript((t) => appendLine(t, "tekan enter"));
    }
    showToast(`Teks "${s.label || s.text.slice(0, 20)}" dikirim`);
    focusKb();
  }
  const flushText = (el: HTMLTextAreaElement) => {
    const v = el.value;
    el.value = "";
    if (v && kbActive) sendText(v);
  };
  const onKbInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if ((e.nativeEvent as InputEvent).isComposing) return; // wait for compositionend
    flushText(e.currentTarget);
  };
  const onKbBlur = () => {
    if (uhidOn) releaseAllKeys();
    // keep keyboard focus unless the user moved into another text field
    window.setTimeout(() => {
      const a = document.activeElement;
      if (kbActive && (!a || a === document.body || a.tagName === "BUTTON")) focusKb();
    }, 0);
  };

  useEffect(() => {
    if (kbActive) focusKb();
    const onWinFocus = () => {
      if (kbActive) focusKb();
    };
    window.addEventListener("focus", onWinFocus);
    return () => window.removeEventListener("focus", onWinFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbActive]);

  // phone -> PC clipboard sync notice (the text itself is written natively in
  // Rust; we only learn how many characters came across)
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    onMirrorClipboard((n) => {
      lastClipEventAt.current = Date.now();
      showToast(`Clipboard HP disalin ke PC (${n} karakter)`);
    }).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
      window.clearTimeout(toastTimer.current);
    };
  }, []);

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
      setStatus("starting");
      setErrorMsg("");
      setDiag("");
      setDisplayOff(false); // a fresh session turns the phone display back on
      setHint(null);
      setAudioState("off");

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

      // Audio frames (only sent when audio is on): PCM to the Web Audio player.
      const audioChan = new Channel<ArrayBuffer>();
      audioChan.onmessage = (buf) => {
        if (!cancelled) playerRef.current?.push(buf);
      };

      if (cancelled) return;
      try {
        started = true;
        const q = QUALITY[quality];
        await mirrorStart(frameChan, q.maxSize, q.bitrate, q.fps, audioOn, audioChan, source);
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
    // A quality / audio change restarts the session (these are server options).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, audioOn, source]);

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
            setDiag((d) => (d ? "" : d)); // a startup hiccup before the first frame is no longer relevant
          }
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- audio ----
  // An AudioContext can only start from a user gesture, so the toggle creates the
  // player synchronously inside its click handler. Any later click / key press also
  // resumes it, which covers a setting restored from the previous session.
  function toggleAudio() {
    const next = !audioOn;
    try {
      localStorage.setItem(LS_AUDIO, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (next) {
      playerRef.current ??= new PcmPlayer();
      playerRef.current.resume();
    } else {
      playerRef.current?.close();
      playerRef.current = null;
      setAudioState("off");
    }
    setAudioOn(next);
  }
  useEffect(() => {
    const wake = () => {
      if (!audioOn) return;
      playerRef.current ??= new PcmPlayer();
      playerRef.current.resume();
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [audioOn]);
  useEffect(
    () => () => {
      playerRef.current?.close();
      playerRef.current = null;
    },
    [],
  );
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    onMirrorAudio((st) => {
      setAudioState(st);
      if (st === "unsupported") showToast("Audio tidak didukung HP ini (butuh Android 11 ke atas)");
      else if (st === "error") showToast("Audio gagal dimulai");
    }).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, []);

  // ---- video source: screen or camera ----
  function chooseSource(next: MirrorSource) {
    if (next === source) return;
    // inspector / recorder read the screen, they make no sense on a camera picture
    setInspecting(false);
    setUiRecording(false);
    setUiTree(null);
    setUiStale(false);
    setSource(next);
    showToast(next === "screen" ? "Kembali menampilkan layar HP" : "Menampilkan kamera HP (hanya lihat), mirror dimulai ulang");
  }

  // ---- quality ----
  function chooseQuality(q: Quality) {
    if (q === quality) return;
    try {
      localStorage.setItem(LS_QUALITY, q);
    } catch {
      /* ignore */
    }
    setQuality(q);
    showToast(`Kualitas ${QUALITY[q].label}: mirror dimulai ulang`);
  }

  // ---- phone display on/off while mirroring ----
  async function toggleDisplay() {
    try {
      await mirrorDisplayPower(displayOff); // currently off -> turn on, and vice versa
      setDisplayOff(!displayOff);
    } catch (e) {
      showToast(`Gagal mengubah layar HP: ${String(e)}`);
    }
  }

  // ---- screen recording (device-side screenrecord, saved when stopped) ----
  useEffect(() => {
    if (!screenRec) return;
    const id = window.setInterval(() => setRecSecs((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [screenRec]);
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    onMirrorRecordError((m) => {
      setScreenRec(false);
      showToast(`Rekam layar gagal: ${m || "penyebab tidak diketahui"}`);
    }).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, []);
  const mmss = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  async function toggleRecord() {
    if (screenRec) {
      setScreenRec(false);
      showToast("Menyimpan rekaman…");
      try {
        const saved = await mirrorRecordStop();
        showToast(saved.length > 0 ? `Rekaman disimpan (${saved.length} file)` : "Tidak ada rekaman yang tersimpan");
      } catch (e) {
        showToast(`Gagal menyimpan rekaman: ${String(e)}`);
      }
      return;
    }
    const dir = await open({ directory: true, multiple: false, title: "Pilih folder untuk menyimpan rekaman" });
    if (typeof dir !== "string") return;
    try {
      await mirrorRecordStart(dir);
      setRecSecs(0);
      setScreenRec(true);
    } catch (e) {
      showToast(`Gagal mulai merekam: ${String(e)}`);
    }
  }

  // ---- copy what's on screen to the PC clipboard as an image ----
  // Done natively: navigator.clipboard.write is rejected by the WebView (NotAllowedError)
  // once we are no longer inside the click handler, and reading the canvas is async.
  // imageDataRef already holds the pixels of the frame currently on screen.
  async function copyFrame() {
    const img = imageDataRef.current;
    if (!img || img.width === 0 || img.height === 0) {
      showToast("Belum ada gambar untuk disalin");
      return;
    }
    try {
      // copy: the paint loop keeps rewriting this buffer
      await pcClipboardSetImage(new Uint8Array(img.data), img.width, img.height);
      showToast(`Tampilan layar disalin ke clipboard (${img.width}×${img.height})`);
    } catch (e) {
      showToast(`Gagal menyalin gambar: ${String(e)}`);
    }
  }

  // ---- drag & drop files onto the window ----
  // .apk -> install, .xapk/.apkm/.apks -> bundle install, anything else -> Download.
  async function handleDropped(paths: string[]) {
    for (const path of paths) {
      const name = path.split(/[/\\]/).pop() ?? path;
      const ext = (name.split(".").pop() ?? "").toLowerCase();
      try {
        if (ext === "apk") {
          showToast(`Memasang ${name}…`);
          const out = await runCapture("adb", ["install", "-r", path]);
          showToast(out.includes("Success") ? `${name} terpasang` : `Gagal memasang ${name}`);
        } else if (ext === "xapk" || ext === "apkm" || ext === "apks") {
          await installXapk(path, false, true);
          showToast(`Memasang ${name}… progres ada di log jendela utama`);
        } else {
          await mirrorPushFile(path);
          showToast(`${name} dikirim ke folder Download HP`);
        }
      } catch (e) {
        showToast(`Gagal memproses ${name}: ${String(e)}`);
      }
    }
  }
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    (async () => {
      const u = await getCurrentWebview().onDragDropEvent((ev) => {
        const t = ev.payload.type;
        if (t === "enter" || t === "over") setDropActive(true);
        else if (t === "leave") setDropActive(false);
        else if (t === "drop") {
          setDropActive(false);
          void handleDropped(ev.payload.paths);
        }
      });
      if (dead) u();
      else un = u;
    })();
    return () => {
      dead = true;
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAndClose() {
    mirrorStop().catch(() => {});
    onClose();
  }

  // ---- UI inspector ----
  async function refreshInspector() {
    setUiBusy(true);
    try {
      const tree = parseUiDump(await mirrorUiDump());
      if (tree.nodes.length === 0) throw new Error("hierarki UI kosong");
      setUiTree(tree);
      setSelId(null);
      setHoverId(null);
      setUiStale(false);
    } catch (e) {
      showToast(`Gagal membaca UI: ${String(e)}`);
    } finally {
      setUiBusy(false);
    }
  }
  /** Re-read the screen shortly after something changed it (recording keeps the tree current). */
  function scheduleUiRefresh() {
    setUiStale(true);
    window.clearTimeout(uiRefreshTimer.current);
    uiRefreshTimer.current = window.setTimeout(() => void refreshInspector(), 900);
  }
  useEffect(() => () => window.clearTimeout(uiRefreshTimer.current), []);
  function toggleUiRecord() {
    if (uiRecording) {
      setUiRecording(false);
      window.clearTimeout(uiRefreshTimer.current);
      if (!inspecting) {
        setUiTree(null);
        setUiStale(false);
      }
      showToast("Rekaman selesai");
      focusKb();
      return;
    }
    setTestScript((t) => (t === EXAMPLE_SCRIPT ? "" : t)); // don't append to the sample
    setUiRecording(true);
    void refreshInspector();
    showToast("Merekam: ketuk dan ketik di layar HP, barisnya masuk ke skrip");
  }
  /** One tap while recording: write `klik <element>` for what was under it. */
  function recordUiTap(nx: number, ny: number) {
    if (!uiTree || uiStale) {
      showToast("Layar belum selesai dibaca, ketukan ini tidak direkam");
      return;
    }
    const node = hitTest(uiTree, nx, ny);
    const tt = node ? tapTarget(uiTree, node) : null;
    if (!tt) {
      setTestScript((t) =>
        appendLine(t, `# ketukan tanpa id atau label di ${Math.round(nx * 100)}%, ${Math.round(ny * 100)}%`),
      );
    } else {
      setTestScript((t) => {
        const base = tt.unique ? t : appendLine(t, `# peringatan: "${tt.target}" tidak unik, yang pertama di layar yang ditekan`);
        return appendLine(base, `klik ${tt.target}`);
      });
    }
    scheduleUiRefresh();
  }
  function insertFromInspector(kind: "klik" | "isi" | "tunggu" | "ada") {
    const node = selId != null && uiTree ? (uiTree.nodes[selId] ?? null) : null;
    const target = node ? targetFor(node) : null;
    if (!target) {
      showToast("Elemen ini tidak punya id atau label untuk dipakai di skrip");
      return;
    }
    const line = kind === "isi" ? `isi ${target} = ` : `${kind} ${target}`;
    setTestScript((t) => appendLine(t === EXAMPLE_SCRIPT ? "" : t, line));
    showToast(kind === "isi" ? "Ditambahkan. Isi nilainya di skrip Tes UI" : `Ditambahkan: ${line}`);
  }
  function toggleInspector() {
    if (inspecting) {
      setInspecting(false);
      if (!uiRecording) setUiTree(null); // recording still needs the tree
      setSelId(null);
      setHoverId(null);
      setUiStale(false);
      focusKb();
    } else {
      setInspecting(true);
      void refreshInspector();
    }
  }
  function inspectAt(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!uiTree || uiStale) return null;
    const { nx, ny } = norm(e);
    return hitTest(uiTree, nx, ny);
  }
  useEffect(() => {
    if (inspecting) inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [inspecting]);
  // the inspector is meaningless once the session is gone
  useEffect(() => {
    if (status !== "live" && (inspecting || uiRecording)) {
      setInspecting(false);
      setUiRecording(false);
      setUiTree(null);
    }
  }, [status, inspecting, uiRecording]);
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    onMirrorHint((kind) => {
      setHint(kind);
      showToast("HP menolak input dari komputer. Lihat saran di panel kanan.");
    }).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, []);

  // ---- input ----
  function norm(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      nx: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      ny: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScreen) return;
    focusKb(); // clicking the screen hands keyboard focus back to the phone
    if (status !== "live") return;
    if (inspecting) {
      setSelId(inspectAt(e)?.id ?? null);
      return;
    }
    const { nx, ny } = norm(e);
    // Mouse buttons act like the Android nav keys: right = Back, middle = Home.
    if (mode === "control" && e.button === 2) {
      mirrorBack().catch(() => {});
      return;
    }
    if (mode === "control" && e.button === 1) {
      e.preventDefault();
      mirrorKeycode(KEY.HOME).catch(() => {});
      return;
    }
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
    // Shift held = pinch: a second finger mirrored through the screen centre.
    pinchRef.current = e.shiftKey;
    mirrorTouch("down", nx, ny).catch(() => {});
    if (pinchRef.current) mirrorTouch("down", 1 - nx, 1 - ny, true).catch(() => {});
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScreen) return;
    if (inspecting) {
      const id = inspectAt(e)?.id ?? null;
      setHoverId((prev) => (prev === id ? prev : id));
      return;
    }
    const { nx, ny } = norm(e);
    if (mode === "edit" && !recording) {
      if (editDownRef.current) editDownRef.current.moved = true;
      return;
    }
    if (!draggingRef.current) return;
    if (editDownRef.current) editDownRef.current.moved = true;
    mirrorTouch("move", nx, ny).catch(() => {});
    if (pinchRef.current) mirrorTouch("move", 1 - nx, 1 - ny, true).catch(() => {});
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isScreen) return;
    if (inspecting) return;
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
    const wasPinch = pinchRef.current;
    pinchRef.current = false;
    mirrorTouch("up", nx, ny).catch(() => {});
    if (wasPinch) mirrorTouch("up", 1 - nx, 1 - ny, true).catch(() => {});

    // recording a Tes UI script: a tap becomes `klik <element>`; a swipe is noted and the tree re-read
    if (uiRecording && start && !wasPinch) {
      if (start.moved && Math.hypot(nx - start.nx, ny - start.ny) > 0.03) {
        setTestScript((t) => appendLine(t, "# geser layar (tidak bisa direkam sebagai langkah)"));
        scheduleUiRefresh();
      } else {
        recordUiTap(start.nx, start.ny);
      }
    }

    // if recording a plain gesture (not a pinch), capture it as a step (with real timing gap)
    if (recording && start && !wasPinch) {
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
    if (!isScreen) return;
    if (inspecting) setUiStale(true); // the screen is about to scroll, so the dump no longer matches
    if (uiRecording) scheduleUiRefresh();
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    mirrorScroll(nx, ny, 0, e.deltaY > 0 ? -1 : 1).catch(() => {});
  };

  // ---- control actions ----
  async function screenshot() {
    const dir = effectiveShotDir || (await downloadDir().catch(() => ""));
    if (!dir) {
      showToast("Folder tujuan belum diketahui. Klik Ubah untuk memilih folder screenshot.");
      return;
    }
    try {
      const saved = await mirrorScreenshot(dir);
      showToast(`Screenshot disimpan: ${saved.split(/[/\\]/).pop() ?? saved}`);
    } catch (e) {
      showToast(`Gagal mengambil screenshot: ${String(e)}`);
    }
  }
  async function chooseShotDir() {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Pilih folder simpan screenshot",
      defaultPath: effectiveShotDir || undefined,
    });
    if (typeof dir !== "string") return;
    setShotDir(dir);
    try {
      localStorage.setItem(LS_SHOT_DIR, dir);
    } catch {
      /* ignore */
    }
    showToast(`Folder screenshot: ${shortPath(dir)}`);
  }
  async function pushFile() {
    const f = await open({ multiple: false, title: "Push file to device" });
    if (typeof f === "string") mirrorPushFile(f).catch(() => {});
  }
  async function rebootPhone() {
    const yes = await ask("HP akan di-restart dan mirror akan terputus. Lanjutkan?", {
      title: "Restart HP",
      kind: "warning",
    }).catch(() => false);
    if (!yes) return;
    mirrorReboot().catch((e) => showToast(`Gagal restart: ${String(e)}`));
  }
  async function pcToPhone() {
    void sendClipboardToPhone(false);
  }
  function phoneToPc() {
    // Same as Ctrl/Cmd+C: press COPY on the phone. (The server never answers a plain
    // "read clipboard" request while autosync is on, so there is no separate "read".)
    doCopy(false);
  }
  function copyText(text: string) {
    pcClipboardSet(text)
      .then(() => showToast("Teks disalin ke clipboard"))
      .catch((e) => showToast(`Gagal menyalin: ${String(e)}`));
  }

  const aspect = frameSize ? frameSize.w / frameSize.h : meta && meta.width ? meta.width / meta.height : 9 / 19.5;

  return (
    <div className="flex h-full gap-3">
      {/* SCREEN AREA — center the device frame; the dark box shrink-wraps the
          phone (fit height + thin padding) instead of stretching full width. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        {status === "error" ? (
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-[var(--color-border)] bg-[#0b1220] p-4">
            <div className="selectable max-w-sm text-center text-sm text-rose-300">
              <p className="mb-2 font-semibold">Mirror error</p>
              <p className="whitespace-pre-wrap break-words opacity-80">{errorMsg}</p>
              {!isScreen && (
                <button
                  onClick={() => chooseSource("screen")}
                  className="no-drag mt-3 inline-flex items-center gap-1.5 rounded-md border border-rose-300/40 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-white/10"
                >
                  <Monitor size={12} /> Kembali ke layar
                </button>
              )}
              {xiaomiFamily && isScreen && (
                <p className="mt-2 text-[11px] leading-snug text-amber-200">
                  HP Xiaomi / Redmi / POCO: nyalakan &quot;USB debugging (Pengaturan keamanan)&quot; di Opsi Pengembang
                  (butuh SIM dan akun Mi), lalu coba lagi.
                </p>
              )}
              <button
                onClick={() => copyText(errorMsg)}
                className="no-drag mt-3 inline-flex items-center gap-1.5 rounded-md border border-rose-300/40 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-white/10"
              >
                <Copy size={12} /> Salin pesan error
              </button>
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
              onPointerLeave={() => inspecting && setHoverId(null)}
              onWheel={wheel}
              onContextMenu={(e) => e.preventDefault()}
              style={{ touchAction: "none", aspectRatio: String(aspect) }}
              className={cn(
                "max-h-full max-w-full rounded-xl bg-black object-contain shadow-lg ring-1",
                inspecting
                  ? "ring-2 ring-amber-400 cursor-crosshair"
                  : mode === "edit"
                    ? "ring-2 ring-[var(--color-brand)] cursor-crosshair"
                    : "ring-white/10",
              )}
            />
            {(mode === "edit" || isRunning) && steps.length > 0 && (
              <StepOverlay steps={steps} active={runningStep} aspect={aspect} />
            )}
            {inspecting && isScreen && uiTree && analysis && !uiStale && (
              <InspectorOverlay tree={uiTree} analysis={analysis} aspect={aspect} hoverId={hoverId} selId={selId} />
            )}
            {/* Hidden keyboard sink: receives the laptop's typing and forwards it
                to the phone. Off-screen but focusable; see the handlers above. */}
            <textarea
              ref={kbRef}
              onKeyDown={onKbKeyDown}
              onKeyUp={onKbKeyUp}
              onInput={onKbInput}
              onCompositionEnd={(e) => flushText(e.currentTarget)}
              onPaste={(e) => {
                e.preventDefault();
                if (kbActive) doPaste();
              }}
              onCopy={(e) => {
                e.preventDefault();
                if (kbActive) doCopy(false);
              }}
              onCut={(e) => {
                e.preventDefault();
                if (kbActive) doCopy(true);
              }}
              onBlur={onKbBlur}
              aria-label="Keyboard input for the phone"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              tabIndex={-1}
              style={{ userSelect: "text", WebkitUserSelect: "text" }}
              className="pointer-events-none absolute left-0 top-0 h-px w-px resize-none opacity-0"
            />
            {dropActive && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--color-brand)] bg-black/60 px-6 text-center text-sm font-semibold text-white">
                Lepas file di sini: APK / XAPK dipasang, file lain dikirim ke folder Download
              </div>
            )}
            {toast && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-black/75 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
                {toast}
              </div>
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
          <div className="ml-auto flex items-center gap-1.5">
            <HelpTip label="Pintasan mouse">
              <p className="mb-1 font-semibold text-[var(--color-ink)]">Pintasan mouse</p>
              <p>Klik kanan = Kembali. Klik tengah = Home. Shift + geser = pinch-zoom (dua jari).</p>
              <p className="mt-1">Seret file ke jendela ini: APK / XAPK dipasang, file lain dikirim ke folder Download HP.</p>
            </HelpTip>
            <button
              onClick={stopAndClose}
              title="Stop mirror"
              className="no-drag flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-500 hover:bg-rose-100"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {meta && frameSize && (
            <div className="mb-3 rounded-lg bg-[var(--color-bg)] px-2.5 py-2 text-[11px] text-[var(--color-ink-soft)]">
              {meta.codec.toUpperCase()} · {frameSize.w}×{frameSize.h}
            </div>
          )}

          {hint === "inject-denied" && (
            <div className="mb-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
              <div className="flex items-start gap-1.5">
                <p className="min-w-0 flex-1 font-semibold">HP menolak sentuhan dan tombol dari komputer</p>
                <button
                  onClick={() => setHint(null)}
                  title="Tutup saran ini"
                  aria-label="Tutup saran ini"
                  className="no-drag shrink-0 text-amber-700 hover:text-amber-900"
                >
                  <X size={13} />
                </button>
              </div>
              {xiaomiFamily ? (
                <p className="mt-1">
                  Di Xiaomi / Redmi / POCO: buka Opsi Pengembang, nyalakan &quot;USB debugging (Pengaturan keamanan)&quot;
                  (butuh SIM dan akun Mi), lalu mulai ulang mirror.
                </p>
              ) : (
                <p className="mt-1">
                  Beberapa HP (Xiaomi, Oppo, Vivo, Realme) memblokir input dari komputer. Cari opsi seperti &quot;USB debugging
                  (Pengaturan keamanan)&quot; atau &quot;Nonaktifkan pemantauan izin&quot; di Opsi Pengembang, lalu mulai ulang mirror.
                </p>
              )}
              <button
                onClick={() => mirrorOpen(INTENT.DEV_OPTIONS).catch(() => {})}
                className="no-drag mt-1.5 inline-flex items-center gap-1 rounded-md border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium hover:bg-amber-100"
              >
                <Code2 size={10} /> Buka Opsi Pengembang
              </button>
            </div>
          )}

          {diag && (
            <div className="mb-3 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-700">
              <div className="selectable break-words font-mono text-[10px]">{diag}</div>
              <button
                onClick={() => copyText(diag)}
                title="Salin pesan ini"
                className="no-drag mt-1.5 inline-flex items-center gap-1 rounded-md border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium hover:bg-amber-100"
              >
                <Copy size={10} /> Salin
              </button>
            </div>
          )}

          <Group title="Device">
            <Ctrl icon={Power} label="Power" hint="Tekan tombol power HP (kunci/buka layar)." onClick={() => mirrorKeycode(KEY.POWER)} />
            <VolumeRow
              onUp={() => mirrorKeycode(KEY.VOLUME_UP).catch(() => {})}
              onDown={() => mirrorKeycode(KEY.VOLUME_DOWN).catch(() => {})}
            />
            <Ctrl icon={RotateCcw} label="Restart" danger hint="Restart HP (ada konfirmasi dulu)." onClick={rebootPhone} />
            <IconRow>
              <IconBtn icon={RotateCw} label="Putar layar" onClick={() => mirrorRotate().catch(() => {})} />
              <IconBtn icon={Bell} label="Notifikasi: buka panel notifikasi" onClick={() => mirrorPanel("notifications")} />
              <IconBtn icon={LayoutGrid} label="Setelan cepat: WiFi, Bluetooth, dll" onClick={() => mirrorPanel("settings")} />
              <IconBtn icon={EyeOff} label="Tutup panel notifikasi / setelan cepat" onClick={() => mirrorPanel("collapse")} />
            </IconRow>
            <IconRow>
              <IconBtn icon={Settings} label="Setelan HP" onClick={() => mirrorOpen(INTENT.SETTINGS)} />
              <IconBtn icon={Code2} label="Opsi Pengembang" onClick={() => mirrorOpen(INTENT.DEV_OPTIONS)} />
              <IconBtn icon={Info} label="Tentang ponsel" onClick={() => mirrorOpen(INTENT.ABOUT)} />
              <IconBtn
                icon={displayOff ? Monitor : MonitorOff}
                label={displayOff ? "Nyalakan layar HP" : "Matikan layar HP (mirror tetap jalan, hemat baterai)"}
                active={displayOff}
                onClick={toggleDisplay}
              />
            </IconRow>
          </Group>

          <Group
            title="Sumber Video"
            help={
              <>
                <p>Tampilkan layar HP atau salah satu kamera HP di komputer. Kamera butuh Android 12 ke atas dan hanya bisa dilihat: tidak ada sentuhan, ketikan, atau Inspector.</p>
                <p className="mt-1">Berguna untuk menguji kamera atau memperlihatkan kamera ke layar besar. Kalau HP tidak mendukung, mirror menampilkan error dan kamu bisa kembali ke Layar.</p>
              </>
            }
          >
            <div className="flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
              {(
                [
                  ["screen", "Layar"],
                  ["camera-back", "Belakang"],
                  ["camera-front", "Depan"],
                ] as [MirrorSource, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => chooseSource(id)}
                  title={id === "screen" ? "Layar HP" : `Kamera ${label.toLowerCase()} HP`}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-[11px] font-medium",
                    source === id ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Group>

          <Group
            title="Kualitas & Suara"
            help={
              <>
                <p>Kualitas video: Hemat 720 px / 4 Mbps, Seimbang 1024 px / 8 Mbps, Tajam 1280 px / 12 Mbps.</p>
                <p className="mt-1">Makin tajam makin berat di CPU. Mengganti kualitas atau suara me-restart mirror.</p>
              </>
            }
          >
            <div className="flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <button
                  key={q}
                  onClick={() => chooseQuality(q)}
                  title={QUALITY[q].hint}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-[11px] font-medium",
                    quality === q ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)]",
                  )}
                >
                  {QUALITY[q].label}
                </button>
              ))}
            </div>
            <Ctrl
              icon={audioOn ? Volume2 : VolumeX}
              label={audioOn ? "Suara HP: ON" : "Suara HP: OFF"}
              hint="Teruskan suara HP ke komputer."
              onClick={toggleAudio}
              help={
                <>
                  {audioOn && (
                    <p className="mb-1 font-semibold text-[var(--color-ink)]">
                      {audioState === "on"
                        ? "Suara HP diteruskan ke komputer."
                        : audioState === "unsupported"
                          ? "HP ini tidak mendukung penerusan suara (butuh Android 11+)."
                          : audioState === "error"
                            ? "Suara gagal dimulai."
                            : "Menyambungkan suara…"}
                    </p>
                  )}
                  <p>Teruskan suara HP ke komputer (butuh Android 11+).</p>
                  <p className="mt-1">Di Android 12 ke bawah speaker HP jadi hening selama diteruskan. Mengubah ini me-restart mirror.</p>
                </>
              }
            />
            <Ctrl
              icon={uhidOn ? Keyboard : KeyboardOff}
              label={uhidOn ? "Keyboard Fisik: ON" : "Keyboard Fisik: OFF"}
              hint="Pakai keyboard laptop sebagai keyboard fisik HP."
              onClick={toggleUhid}
              help={
                <>
                  <p>Seperti scrcpy -K: HP menganggap keyboard laptop sebagai keyboard USB, jadi keyboard layar HP tidak muncul saat mengetik.</p>
                  <p className="mt-1">Karakter ditentukan layout keyboard fisik di HP (Setelan &gt; Keyboard fisik), jadi samakan dengan layout laptop. Cmd di Mac dikirim sebagai Ctrl.</p>
                  <p className="mt-1">Kalau keyboard layar masih muncul, matikan &quot;Tampilkan keyboard virtual&quot; di pengaturan keyboard fisik HP.</p>
                </>
              }
            />
          </Group>

          <Group
            title="Clipboard (Salin-Tempel)"
            help={
              <>
                <p>Ketik langsung dengan keyboard laptop.</p>
                <p className="mt-1">Pilih teks di HP (tekan lama), lalu Ctrl/Cmd+C untuk menyalin ke komputer. Teks yang disalin lewat menu HP juga otomatis masuk ke clipboard komputer.</p>
                <p className="mt-1">Ctrl/Cmd+V menempel ke HP, Ctrl/Cmd+A pilih semua.</p>
              </>
            }
          >
            <Ctrl icon={ArrowDownToLine} label="Kirim ke HP" hint="Kirim teks yang disalin di komputer ke clipboard HP." onClick={pcToPhone} />
            <Ctrl icon={ArrowUpFromLine} label="Salin dari HP" hint="Salin teks yang sedang DIPILIH di HP ke clipboard komputer (sama dengan Ctrl/Cmd+C). Pilih teksnya dulu di HP." onClick={phoneToPc} />
          </Group>

          <Group
            title="Teks Tersimpan"
            help={
              <>
                <p>Simpan teks yang sering dipakai (email, kata sandi uji, nomor). Klik satu untuk langsung mengetiknya di kolom yang sedang aktif di HP.</p>
                <p className="mt-1">Teks biasa diketik seperti keyboard. Teks dengan huruf non-ASCII, emoji, atau baris baru ditempel lewat clipboard HP, sehingga isi clipboard HP tertimpa.</p>
                <p className="mt-1">Disimpan di komputer ini sebagai teks biasa. Jangan simpan kata sandi yang sebenarnya.</p>
              </>
            }
          >
            <SnippetsPanel onSend={sendSnippet} onFocusPhone={focusKb} />
          </Group>

          <Group title="File">
            <Ctrl icon={Camera} label="Screenshot" hint="Ambil tangkapan layar HP dan langsung simpan ke folder di bawah (tanpa dialog)." onClick={screenshot} />
            <div className="flex items-center gap-1.5 px-1 text-[10px] text-[var(--color-ink-faint)]">
              <FolderIcon size={11} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={effectiveShotDir || "Memuat folder Downloads…"}>
                {effectiveShotDir ? shortPath(effectiveShotDir) : "Memuat…"}
              </span>
              <button
                onClick={chooseShotDir}
                title={`Ubah folder simpan screenshot${effectiveShotDir ? ` (sekarang: ${effectiveShotDir})` : ""}`}
                className="no-drag shrink-0 rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
              >
                Ubah
              </button>
            </div>
            <Ctrl icon={Copy} label="Salin Tampilan" hint="Salin gambar layar (resolusi mirror) ke clipboard komputer." onClick={copyFrame} />
            <Ctrl
              icon={Video}
              label={screenRec ? `Stop Rekam ${mmss(recSecs)}` : "Rekam Layar"}
              danger={screenRec}
              hint="Rekam layar HP ke file MP4 (tanpa suara). Dipecah per 3 menit dan disimpan ke folder yang kamu pilih saat berhenti."
              onClick={toggleRecord}
            />
            <Ctrl icon={Upload} label="Kirim File" hint="Kirim file dari komputer ke folder Download HP." onClick={pushFile} />
          </Group>

          <Group
            title="Debug"
            help={
              <>
                <p>Inspector UI membaca hierarki tampilan HP dan menandai elemen di layar: hijau punya resource-id (semantic identifier), biru hanya punya label/teks, merah bisa diklik tapi tanpa id.</p>
                <p className="mt-1">Saat aktif, klik tidak diteruskan ke HP. Klik elemen untuk melihat detail dan menyalin id atau XPath. Setelah layar HP berubah, tekan Muat ulang.</p>
              </>
            }
          >
            <Ctrl
              icon={ScanSearch}
              label={inspecting ? "Inspector UI: ON" : "Inspector UI: OFF"}
              hint="Tandai elemen layar yang punya semantic identifier."
              onClick={toggleInspector}
            />
            {inspecting && (
              <div ref={inspectorRef}>
                <InspectorPanel
                  tree={uiTree}
                  analysis={analysis}
                  node={selId != null && uiTree ? (uiTree.nodes[selId] ?? null) : null}
                  busy={uiBusy}
                  stale={uiStale}
                  onRefresh={refreshInspector}
                  onCopy={copyText}
                  onInsert={insertFromInspector}
                />
              </div>
            )}
          </Group>

          <Group
            title="Tes UI"
            help={
              <>
                <p>Skrip tes sederhana: tiap baris mencari elemen di layar HP (lewat resource-id, lalu label, lalu teks), lalu menekan, mengisi, atau memeriksanya. Berhenti di baris pertama yang gagal.</p>
                <p className="mt-1 font-mono text-[10px] leading-snug">
                  klik btn_login
                  <br />
                  isi login_email = user@test.com
                  <br />
                  tunggu home_title
                  <br />
                  ada home_title
                  <br />
                  tidak ada error_box
                  <br />
                  cek home_title = Halo
                  <br />
                  jeda 2
                </p>
                <p className="mt-1 font-mono text-[10px] leading-snug">
                  jika ada popup_ok
                  <br />
                  &nbsp;&nbsp;klik popup_ok
                  <br />
                  lainnya
                  <br />
                  &nbsp;&nbsp;jeda 1
                  <br />
                  selesai
                  <br />
                  ulangi 3 ... selesai
                  <br />
                  tekan enter
                </p>
                <p className="mt-1">Kalau satu langkah gagal, screenshot HP disimpan otomatis ke folder screenshot dan hasilnya bisa disimpan lewat &quot;Simpan hasil&quot;.</p>
                <p className="mt-1">Baris berawalan # adalah komentar. Isi mengganti teks yang sudah ada. Pakai Inspector UI untuk melihat id yang tersedia.</p>
              </>
            }
          >
            <UiTestPanel
              script={testScript}
              setScript={setTestScript}
              recording={uiRecording}
              onToggleRecord={toggleUiRecord}
              live={status === "live"}
              onDump={async () => parseUiDump(await mirrorUiDump())}
              onTap={async (nx, ny) => {
                await mirrorTouch("down", nx, ny);
                await new Promise((r) => setTimeout(r, 60));
                await mirrorTouch("up", nx, ny);
              }}
              onKey={(k, m) => mirrorKeycode(k, m)}
              onType={async (t) => {
                await (isDirectlyTypable(t) ? mirrorText(t) : mirrorPasteText(t));
              }}
              onFocusPhone={focusKb}
              onScreenshot={async () => mirrorScreenshot(effectiveShotDir || (await downloadDir()))}
              deviceName={[device.brand, device.model].filter(Boolean).join(" ") || device.serial}
            />
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

function Group({ title, help, children }: { title: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        <span>{title}</span>
        {help && <HelpTip label={`Bantuan: ${title}`}>{help}</HelpTip>}
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
  help,
}: {
  icon: typeof Power;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
  /** when set, a "?" button is placed to the right of the button and shows this on hover */
  help?: React.ReactNode;
}) {
  const button = (
    <button
      onClick={() => onClick()}
      title={hint ?? label}
      className={cn(
        "no-drag flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        help && "min-w-0 flex-1",
        danger
          ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)]",
      )}
    >
      <Icon size={15} className={danger ? "" : "text-[var(--color-brand-600)]"} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
  if (!help) return button;
  return (
    <div className="flex items-center gap-1.5">
      {button}
      <HelpTip variant="box" label={`Bantuan: ${label}`}>
        {help}
      </HelpTip>
    </div>
  );
}

/**
 * Volume as one row: a caption box (styled like a button but not clickable, in a muted
 * colour) followed by two square buttons, "+" and "-", exactly as wide as they are tall.
 * 38px matches the height of the other panel buttons (20px line + 2 x 8px padding + 2 x 1px border).
 */
function VolumeRow({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  const square =
    "no-drag flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand-600)] transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)] active:scale-[0.97]";
  return (
    <div className="flex items-center gap-1.5">
      <div
        role="presentation"
        className="flex h-[38px] min-w-0 flex-1 cursor-default select-none items-center gap-2.5 rounded-lg bg-[var(--color-surface-2)] px-3 text-sm font-medium text-[var(--color-ink-soft)]"
      >
        <Volume2 size={15} className="shrink-0" />
        <span className="min-w-0 truncate">Volume</span>
      </div>
      <button onClick={onUp} title="Naikkan volume HP" aria-label="Volume naik" className={square}>
        <Plus size={16} />
      </button>
      <button onClick={onDown} title="Turunkan volume HP" aria-label="Volume turun" className={square}>
        <Minus size={16} />
      </button>
    </div>
  );
}

function IconRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-1.5">{children}</div>;
}

/** Square icon-only button; the tooltip (title) carries the name. */
function IconBtn({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Power;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={() => onClick()}
      title={label}
      aria-label={label}
      className={cn(
        "no-drag flex h-[38px] min-w-0 flex-1 items-center justify-center rounded-lg border transition-colors active:scale-[0.97]",
        active
          ? "border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-brand-600)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)]",
      )}
    >
      <Icon size={16} />
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
    <Group
      title="Auto-Clicker"
      help={
        <>
          <p className="mb-1 font-semibold text-[var(--color-ink)]">
            {p.mode === "edit" ? "Mode Edit Titik" : "Mode Kontrol"}
          </p>
          <p>
            {p.mode === "edit"
              ? "Klik layar untuk menambah titik, geser untuk swipe. Titik muncul bernomor."
              : "Klik mengendalikan HP. Aktifkan Rekam untuk mencatat klikmu."}
          </p>
        </>
      }
    >
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
