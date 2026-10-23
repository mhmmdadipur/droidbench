import { createContext, useContext, useState, type ReactNode } from "react";

interface MirrorCtx {
  active: boolean;
  start: () => void;
  stop: () => void;
}

const Ctx = createContext<MirrorCtx | null>(null);

export function MirrorProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  return (
    <Ctx.Provider value={{ active, start: () => setActive(true), stop: () => setActive(false) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMirror() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMirror must be used within MirrorProvider");
  return ctx;
}
