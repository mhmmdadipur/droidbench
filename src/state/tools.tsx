import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { checkTools, type ToolStatus } from "../lib/api";

interface ToolsCtx {
  tools: ToolStatus[];
  refresh: () => void;
  get: (name: string) => ToolStatus | undefined;
}

const Ctx = createContext<ToolsCtx | null>(null);

export function ToolsProvider({ children }: { children: ReactNode }) {
  const [tools, setTools] = useState<ToolStatus[]>([]);

  const refresh = useCallback(async () => {
    try {
      setTools(await checkTools());
    } catch {
      setTools([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const get = useCallback(
    (name: string) => tools.find((t) => t.name === name),
    [tools],
  );

  return <Ctx.Provider value={{ tools, refresh, get }}>{children}</Ctx.Provider>;
}

export function useTools2() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTools2 must be used within ToolsProvider");
  return ctx;
}
