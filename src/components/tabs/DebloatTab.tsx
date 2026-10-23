import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import {
  listDisabledPackages,
  listInstalledPackages,
  loadDebloatDb,
  type DebloatDatabase,
} from "../../lib/api";
import { useTools } from "../../lib/useTools";
import { useLog } from "../../state/log";

type DbId = "xiaomi" | "universal" | "tv";

const DB_TABS: { id: DbId; label: string }[] = [
  { id: "xiaomi", label: "Xiaomi / MIUI" },
  { id: "universal", label: "Universal" },
  { id: "tv", label: "Android TV" },
];

export function DebloatTab() {
  const t = useTools();
  const { push } = useLog();
  const [dbId, setDbId] = useState<DbId>("xiaomi");
  const [db, setDb] = useState<DebloatDatabase | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadDb = useCallback(async (id: DbId) => {
    setLoading(true);
    try {
      const data = await loadDebloatDb(id);
      setDb(data);
      setSelected(new Set());
    } catch (e) {
      push(String(e), "stderr");
      setDb(null);
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadDb(dbId);
  }, [dbId, loadDb]);

  async function refreshStatus() {
    try {
      const [inst, dis] = await Promise.all([
        listInstalledPackages(),
        listDisabledPackages(),
      ]);
      setInstalled(new Set(inst));
      setDisabled(new Set(dis));
      push(`Status refreshed: ${inst.length} packages present, ${dis.length} disabled.`, "system");
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  const allEntries = useMemo(
    () => (db ? db.categories.flatMap((c) => c.entries) : []),
    [db],
  );

  function toggle(pkg: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(pkg) ? n.delete(pkg) : n.add(pkg);
      return n;
    });
  }

  function selectAllPresent() {
    const present = allEntries
      .filter((e) => installed.size === 0 || installed.has(e.package))
      .filter((e) => !disabled.has(e.package))
      .map((e) => e.package);
    setSelected(new Set(present));
  }

  function statusOf(pkg: string): "on" | "off" | "absent" {
    if (disabled.has(pkg)) return "off";
    if (installed.size > 0 && !installed.has(pkg)) return "absent";
    return "on";
  }

  function apply(enable: boolean) {
    const pkgs = [...selected];
    if (pkgs.length === 0) {
      push("No packages selected.", "stderr");
      return;
    }
    if (dryRun) {
      push(
        `[DRY-RUN] Would ${enable ? "enable" : "disable"} ${pkgs.length} packages:`,
        "system",
      );
      pkgs.forEach((p) => push(`  · ${p}`, "system"));
      return;
    }
    // Run them sequentially via adb shell pm. One command does several packages
    // by chaining — but pm takes one package at a time, so we enqueue each.
    pkgs.forEach((p) => {
      const sub = enable ? ["enable", p] : ["disable-user", "--user", "0", p];
      t.adb(["shell", "pm", ...sub]);
    });
    push(
      `${enable ? "Enabled" : "Disabled"} ${pkgs.length} packages via adb.`,
      "system",
    );
  }

  return (
    <>
      {/* DB selector */}
      <div className="mb-3 flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
        {DB_TABS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDbId(d.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              dbId === d.id
                ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm"
                : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={refreshStatus}>
          Scan device
        </Button>
        <Button size="sm" className="flex-1" onClick={selectAllPresent}>
          Select all present
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
          Clear
        </Button>
      </div>

      <label className="mb-2 flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => setDryRun(e.target.checked)}
          className="accent-[var(--color-brand)]"
        />
        Simulation mode (dry-run, no changes)
      </label>

      {/* package list */}
      <div className="mb-3 max-h-[46vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {loading ? (
          <div className="p-4 text-sm text-[var(--color-ink-faint)]">Loading database…</div>
        ) : !db ? (
          <div className="p-4 text-sm text-[var(--color-danger-600)]">
            Database not found. Bundle it under <code>databases/{dbId}.json</code>.
          </div>
        ) : (
          db.categories.map((cat) => (
            <div key={cat.name}>
              <div className="sticky top-0 bg-[var(--color-surface-2)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                {cat.name}
              </div>
              {cat.entries.map((e) => {
                const st = statusOf(e.package);
                return (
                  <label
                    key={e.package}
                    className="flex cursor-pointer items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-sm last:border-0 hover:bg-[var(--color-bg)]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(e.package)}
                      onChange={() => toggle(e.package)}
                      className="accent-[var(--color-brand)]"
                    />
                    <span className="flex-1 truncate">
                      <span className="text-[var(--color-ink)]">{e.label || e.package}</span>
                      {e.label && (
                        <span className="ml-1 text-xs text-[var(--color-ink-faint)]">
                          {e.package}
                        </span>
                      )}
                    </span>
                    <StatusDot status={st} />
                  </label>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="danger" className="flex-1" onClick={() => apply(false)}>
          Disable selected
        </Button>
        <Button variant="success" className="flex-1" onClick={() => apply(true)}>
          Restore selected
        </Button>
      </div>

      {db && (
        <div className="mt-2 text-[11px] text-[var(--color-ink-faint)]">
          Source: {db.source}
        </div>
      )}
    </>
  );
}

function StatusDot({ status }: { status: "on" | "off" | "absent" }) {
  const map = {
    on: { c: "bg-emerald-500", t: "ON" },
    off: { c: "bg-amber-500", t: "OFF" },
    absent: { c: "bg-slate-300", t: "—" },
  } as const;
  const { c, t } = map[status];
  return (
    <span className="flex items-center gap-1 text-[10px] text-[var(--color-ink-faint)]">
      <span className={`h-2 w-2 rounded-full ${c}`} />
      {t}
    </span>
  );
}
