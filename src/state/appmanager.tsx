import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useDevice } from "./device";
import type { DebloatDatabase } from "../lib/api";
import type { RiskLevel, DebloatHit } from "../lib/apps";

export type AppKind = "all" | "menu" | "bg";
export type MarketStatus = "blocked" | "active" | "unknown";
export type DbId = "xiaomi" | "universal" | "tv";
export type RiskFilter = RiskLevel;

interface AppManagerCtx {
  // installed apps
  all: string[];
  disabled: Set<string>;
  launchable: Set<string>;
  query: string;
  kind: AppKind;
  selected: string | null;
  marketStatus: MarketStatus;
  debloatIndex: Map<string, DebloatHit>;
  setAll: (v: string[]) => void;
  setDisabled: (v: Set<string>) => void;
  setLaunchable: (v: Set<string>) => void;
  setQuery: (v: string) => void;
  setKind: (v: AppKind) => void;
  setSelected: (v: string | null) => void;
  setMarketStatus: (v: MarketStatus) => void;
  setDebloatIndex: (v: Map<string, DebloatHit>) => void;
  // debloat section
  dbId: DbId;
  db: DebloatDatabase | null;
  riskFilter: RiskFilter;
  checked: Set<string>;
  dryRun: boolean;
  setDbId: (v: DbId) => void;
  setDb: (v: DebloatDatabase | null) => void;
  setRiskFilter: (v: RiskFilter) => void;
  setChecked: (v: Set<string>) => void;
  setDryRun: (v: boolean) => void;
}

const Ctx = createContext<AppManagerCtx | null>(null);

/** Holds the merged Apps tab state (installed apps + debloat) so it survives
 * tab switches, and clears per-device data when the device is unplugged. */
export function AppManagerProvider({ children }: { children: ReactNode }) {
  const { device } = useDevice();
  const [all, setAll] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [launchable, setLaunchable] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AppKind>("menu");
  const [selected, setSelected] = useState<string | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>("unknown");
  const [debloatIndex, setDebloatIndex] = useState<Map<string, DebloatHit>>(new Map());

  const [dbId, setDbId] = useState<DbId>("universal");
  const [db, setDb] = useState<DebloatDatabase | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("recommended");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dryRun, setDryRun] = useState(true);

  // Per-device data is cleared on disconnect; the chosen DB/filter (UI prefs)
  // are kept.
  useEffect(() => {
    if (!device.connected) {
      setAll([]);
      setDisabled(new Set());
      setLaunchable(new Set());
      setQuery("");
      setKind("menu");
      setSelected(null);
      setMarketStatus("unknown");
      setChecked(new Set());
      setDebloatIndex(new Map());
    }
  }, [device.connected]);

  return (
    <Ctx.Provider
      value={{
        all,
        disabled,
        launchable,
        query,
        kind,
        selected,
        marketStatus,
        debloatIndex,
        setAll,
        setDisabled,
        setLaunchable,
        setQuery,
        setKind,
        setSelected,
        setMarketStatus,
        setDebloatIndex,
        dbId,
        db,
        riskFilter,
        checked,
        dryRun,
        setDbId,
        setDb,
        setRiskFilter,
        setChecked,
        setDryRun,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppManager must be used within AppManagerProvider");
  return ctx;
}
