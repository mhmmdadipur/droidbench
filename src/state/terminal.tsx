import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useDevice } from "./device";
import { adbShell } from "../lib/api";

export interface TermEntry {
  id: number;
  cmd: string;
  /** stdout + stderr; empty while running */
  out: string;
  state: "running" | "ok" | "error";
  ms: number;
}

interface TerminalCtx {
  entries: TermEntry[];
  /** commands typed before (newest last), for the Up / Down arrows */
  history: string[];
  busy: boolean;
  run: (cmd: string) => Promise<void>;
  clear: () => void;
}

const Ctx = createContext<TerminalCtx | null>(null);
const MAX_ENTRIES = 200;

/**
 * The `adb shell` terminal's output. Lives at app level so it survives tab switches (and a
 * command keeps running while another tab is open), and is cleared when the phone is
 * unplugged or another one is picked: the output belongs to one device. The command history
 * (just text) is kept.
 */
export function TerminalProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [entries, setEntries] = useState<TermEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  // bumped when the device changes, so a command that finishes later is not added to the new device's output
  const epoch = useRef(0);

  useEffect(() => {
    epoch.current++;
    setEntries([]);
    setBusy(false);
  }, [device.connected, device.serial]);

  const run = useCallback(async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    const id = nextId.current++;
    const at = epoch.current;
    const t0 = Date.now();
    setHistory((h) => (h[h.length - 1] === cmd ? h : [...h.slice(-99), cmd]));
    setEntries((e) => [...e.slice(-(MAX_ENTRIES - 1)), { id, cmd, out: "", state: "running", ms: 0 }]);
    setBusy(true);
    let out = "";
    let state: TermEntry["state"] = "ok";
    try {
      out = await adbShell(cmd, 30);
    } catch (e) {
      out = String(e);
      state = "error";
    }
    if (at !== epoch.current) return; // device changed meanwhile
    setEntries((list) => list.map((x) => (x.id === id ? { ...x, out, state, ms: Date.now() - t0 } : x)));
    setBusy(false);
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return <Ctx.Provider value={{ entries, history, busy, run, clear }}>{children}</Ctx.Provider>;
}

export function useTerminal() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTerminal must be used within TerminalProvider");
  return ctx;
}
