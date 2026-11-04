import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDevice } from "./device";
import type { IosApp } from "../lib/api";

interface IosToolsCtx {
  /** Last-scanned installed app list (null = not scanned yet). */
  apps: IosApp[] | null;
  setApps: (a: IosApp[] | null) => void;
}

const Ctx = createContext<IosToolsCtx | null>(null);

/**
 * Holds iOS tools state (installed app list) at app level so it survives tab
 * switches, and clears it when the device is unplugged / is no longer iOS —
 * the data only describes the iPhone that was actually connected.
 */
export function IosToolsProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [apps, setApps] = useState<IosApp[] | null>(null);

  useEffect(() => {
    if (!device.connected || device.mode !== "ios") setApps(null);
  }, [device.connected, device.mode]);

  return <Ctx.Provider value={{ apps, setApps }}>{children}</Ctx.Provider>;
}

export function useIosTools() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useIosTools must be used within IosToolsProvider");
  return ctx;
}
