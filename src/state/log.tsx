import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cancelCommand,
  onDone,
  onLog,
  runCommand,
  type CommandDone,
  type LogLine,
  type LogStream,
} from "../lib/api";

export interface LogEntry {
  key: number;
  stream: LogStream;
  text: string;
  ts: number;
}

interface LogCtx {
  entries: LogEntry[];
  running: boolean;
  runningId: string | null;
  push: (text: string, stream?: LogStream) => void;
  clear: () => void;
  /** Run a streaming command and track it as the active command. */
  run: (tool: string, args: string[], usePath?: boolean) => Promise<void>;
  cancel: () => void;
}

const Ctx = createContext<LogCtx | null>(null);

let counter = 0;

export function LogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>([
    { key: counter++, stream: "system", text: "Droidbench ready.", ts: Date.now() },
  ]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const runningIdRef = useRef<string | null>(null);

  const push = useCallback((text: string, stream: LogStream = "system") => {
    setEntries((prev) => {
      const next = [...prev, { key: counter++, stream, text, ts: Date.now() }];
      // cap log to 5000 lines to stay responsive
      return next.length > 5000 ? next.slice(next.length - 5000) : next;
    });
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  // wire backend events once
  useEffect(() => {
    let unlistenLog: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    const mirrorUnlisten: Array<() => void> = [];

    onLog((l: LogLine) => push(l.line, l.stream)).then((u) => (unlistenLog = u));
    onDone((d: CommandDone) => {
      if (d.id === runningIdRef.current) {
        push(
          d.success
            ? `✓ done (exit ${d.code ?? 0})`
            : `✗ failed (exit ${d.code ?? "?"})`,
          d.success ? "system" : "stderr",
        );
        runningIdRef.current = null;
        setRunningId(null);
      }
    }).then((u) => (unlistenDone = u));

    // Mirror events are broadcast from the mirror window; surface them in the
    // main Command Log so they can be read/copied here too.
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string>("mirror-diag", (e) => push(`[mirror] ${e.payload}`, "system")).then(
        (u) => mirrorUnlisten.push(u),
      );
      listen<string>("mirror-error", (e) => push(`[mirror] ERROR: ${e.payload}`, "stderr")).then(
        (u) => mirrorUnlisten.push(u),
      );
      listen<{ device_name: string; codec: string }>("mirror-meta", (e) =>
        push(`[mirror] connected: ${e.payload.device_name} (${e.payload.codec})`, "system"),
      ).then((u) => mirrorUnlisten.push(u));
      listen("mirror-stopped", () => push("[mirror] stopped", "system")).then((u) =>
        mirrorUnlisten.push(u),
      );
    });

    return () => {
      unlistenLog?.();
      unlistenDone?.();
      mirrorUnlisten.forEach((u) => u());
    };
  }, [push]);

  const run = useCallback(async (tool: string, args: string[], usePath = false) => {
    try {
      const id = await runCommand(tool, args, usePath);
      runningIdRef.current = id;
      setRunningId(id);
    } catch (e) {
      push(String(e), "stderr");
    }
  }, [push]);

  const cancel = useCallback(() => {
    cancelCommand(runningIdRef.current ?? undefined);
    push("Command cancelled by user.", "system");
    runningIdRef.current = null;
    setRunningId(null);
  }, [push]);

  return (
    <Ctx.Provider
      value={{
        entries,
        running: runningId !== null,
        runningId,
        push,
        clear,
        run,
        cancel,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useLog() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLog must be used within LogProvider");
  return ctx;
}
