import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { detectDevice, type DeviceInfo } from "../lib/api";

interface DeviceCtx {
  device: DeviceInfo;
  refreshing: boolean;
  refresh: () => void;
}

const empty: DeviceInfo = {
  connected: false,
  mode: "none",
  serial: "",
  brand: "",
  model: "",
  android: "",
  rom: "",
};

const Ctx = createContext<DeviceCtx | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<DeviceInfo>(empty);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const info = await detectDevice();
      setDevice(info);
    } catch {
      setDevice(empty);
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ device, refreshing, refresh }}>{children}</Ctx.Provider>;
}

export function useDevice() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDevice must be used within DeviceProvider");
  return ctx;
}
