import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useDevice } from "./device";
import type { CheckState, DiagnosticReport } from "../lib/diagnostics";

interface DiagnosticCtx {
  report: DiagnosticReport | null;
  setReport: (r: DiagnosticReport | null) => void;
  checks: Record<string, CheckState>;
  setCheck: (id: string, state: CheckState) => void;
  clear: () => void;
}

const Ctx = createContext<DiagnosticCtx | null>(null);

/**
 * Holds the diagnostic scan result at app level so it survives tab switches
 * (the tab component unmounts when another tab is shown) but is cleared when
 * the device is unplugged — the report belongs to a specific connected phone.
 */
export function DiagnosticProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [checks, setChecksState] = useState<Record<string, CheckState>>({});

  function setCheck(id: string, state: CheckState) {
    setChecksState((p) => ({ ...p, [id]: state }));
  }
  function clear() {
    setReport(null);
    setChecksState({});
  }

  // Clear the report + checklist when the device disconnects: the results are
  // only meaningful for the phone that was actually plugged in.
  useEffect(() => {
    if (!device.connected) {
      setReport(null);
      setChecksState({});
    }
  }, [device.connected]);

  return (
    <Ctx.Provider value={{ report, setReport, checks, setCheck, clear }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDiagnostic() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDiagnostic must be used within DiagnosticProvider");
  return ctx;
}
