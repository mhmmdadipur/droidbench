import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useDevice } from "./device";

export interface DnsStatus {
  mode: string;
  host: string;
}

interface ConnectivityCtx {
  current: DnsStatus | null;
  setCurrent: (s: DnsStatus | null) => void;
}

const Ctx = createContext<ConnectivityCtx | null>(null);

/** Holds the read Private-DNS status so it survives tab switches, and clears
 * it when the device is unplugged. */
export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [current, setCurrent] = useState<DnsStatus | null>(null);

  useEffect(() => {
    if (!device.connected) setCurrent(null);
  }, [device.connected]);

  return <Ctx.Provider value={{ current, setCurrent }}>{children}</Ctx.Provider>;
}

export function useConnectivity() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConnectivity must be used within ConnectivityProvider");
  return ctx;
}
