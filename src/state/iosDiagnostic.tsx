import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDevice } from "./device";
import type { IosReport } from "../lib/api";

interface IosDiagCtx {
  report: IosReport | null;
  setReport: (r: IosReport | null) => void;
  clear: () => void;
}

const Ctx = createContext<IosDiagCtx | null>(null);

/**
 * Holds the iOS diagnostic report at app level so it survives tab switches,
 * but clears it when the device is unplugged / is no longer an iOS device —
 * the report only describes the iPhone that was actually connected.
 */
export function IosDiagnosticProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [report, setReport] = useState<IosReport | null>(null);

  function clear() {
    setReport(null);
  }

  useEffect(() => {
    if (!device.connected || device.mode !== "ios") setReport(null);
  }, [device.connected, device.mode]);

  return <Ctx.Provider value={{ report, setReport, clear }}>{children}</Ctx.Provider>;
}

export function useIosDiagnostic() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIosDiagnostic must be used within IosDiagnosticProvider");
  return ctx;
}
