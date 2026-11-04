import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useDevice } from "./device";
import type { LockState } from "../lib/flashStatus";
import { readLockState } from "../lib/flashStatus";

/** Shared flashing-workflow state, lifted to app level so it survives tab
 * switches, and reset when the device is disconnected (the lock state only
 * describes the phone that was actually connected). */
interface FlashingCtx {
  /** Last-known bootloader unlock state (from fastboot getvar). */
  lock: LockState;
  setLock: (s: LockState) => void;
  /** Re-read the lock state now (works in ADB and Fastboot mode). */
  refreshLock: () => Promise<LockState>;
  /** Selected Xiaomi firmware folder (persists across tab switches). */
  xiaomiFolder: string;
  setXiaomiFolder: (f: string) => void;
  /** What the Xiaomi flow is installing: official firmware or a custom ROM. */
  xiaomiTarget: "official" | "custom";
  setXiaomiTarget: (t: "official" | "custom") => void;
  /** Samsung firmware files picked per Odin slot (BL/AP/CP/CSC/…). */
  samsungFiles: Record<string, string>;
  setSamsungFiles: Dispatch<SetStateAction<Record<string, string>>>;
  /** Which step is expanded, per workflow id. */
  openStep: Record<string, number>;
  setOpenStep: (workflow: string, index: number) => void;
  /** Open exactly this step (unlike setOpenStep, never collapses it). */
  showStep: (workflow: string, index: number) => void;
  /** Navigate to another app tab by id (registered by the App shell). */
  goToTab: (tab: string) => void;
  registerNavigator: (fn: (tab: string) => void) => void;
}

const Ctx = createContext<FlashingCtx | null>(null);

export function FlashingProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [lock, setLock] = useState<LockState>("unknown");
  const [xiaomiFolder, setXiaomiFolder] = useState("");
  const [xiaomiTarget, setXiaomiTarget] = useState<"official" | "custom">("official");
  const [samsungFiles, setSamsungFiles] = useState<Record<string, string>>({});
  // Step 1 is open by default for every workflow. Per-brand tabs ("brand-<id>")
  // are not listed here: a missing key means "step 1 open".
  const [openStep, setOpenStepState] = useState<Record<string, number>>({
    xiaomi: 1,
    samsung: 1,
    fastboot: 1,
    root: 1,
    customrom: 1,
  });
  const navRef = useRef<(tab: string) => void>(() => {});

  function setOpenStep(workflow: string, index: number) {
    setOpenStepState((prev) => ({ ...prev, [workflow]: (prev[workflow] ?? 1) === index ? -1 : index }));
  }

  const showStep = useCallback((workflow: string, index: number) => {
    setOpenStepState((prev) => ({ ...prev, [workflow]: index }));
  }, []);

  const goToTab = useCallback((tab: string) => {
    navRef.current(tab);
  }, []);
  const registerNavigator = useCallback((fn: (tab: string) => void) => {
    navRef.current = fn;
  }, []);

  // Auto-read the bootloader state whenever a phone is (re)detected in ADB or
  // Fastboot mode, so the status isn't stuck on "unknown" until a manual
  // re-check. Reset it when the phone is unplugged.
  const refreshLock = useCallback(async (): Promise<LockState> => {
    if (!device.connected || (device.mode !== "adb" && device.mode !== "fastboot")) {
      return "unknown";
    }
    const s = await readLockState(device.mode);
    setLock(s);
    return s;
  }, [device.connected, device.mode]);

  useEffect(() => {
    if (!device.connected) {
      setLock("unknown");
      return;
    }
    if (device.mode === "adb" || device.mode === "fastboot") {
      void refreshLock();
    }
  }, [device.connected, device.mode, device.serial, refreshLock]);

  return (
    <Ctx.Provider
      value={{ lock, setLock, refreshLock, xiaomiFolder, setXiaomiFolder, xiaomiTarget, setXiaomiTarget, samsungFiles, setSamsungFiles, openStep, setOpenStep, showStep, goToTab, registerNavigator }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useFlashing() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFlashing must be used within FlashingProvider");
  return ctx;
}
