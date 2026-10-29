import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw, Search, Store, PackagePlus } from "lucide-react";
import { Button } from "../ui/Button";
import { Row, Section, TabHelp } from "../ui/Section";
import {
  listInstalledPackages,
  listDisabledPackages,
  loadDebloatDb,
  runCapture,
  type DebloatDatabase,
} from "../../lib/api";
import { useLog } from "../../state/log";
import { useDevice } from "../../state/device";
import { useAppManager, type DbId, type RiskFilter } from "../../state/appmanager";
import { useI18n, type TKey } from "../../i18n";
import {
  deriveAppName,
  buildDebloatIndex,
  type RiskLevel,
} from "../../lib/apps";

const MARKET_HANDLER =
  "com.android.vending/com.google.android.finsky.activities.MarketDeepLinkHandlerActivity";

const DB_TABS: { id: DbId; labelKey: TKey }[] = [
  { id: "xiaomi", labelKey: "db.db.xiaomi" },
  { id: "universal", labelKey: "db.db.universal" },
  { id: "tv", labelKey: "db.db.tv" },
];

const RISK_META: Record<RiskLevel, { labelKey: TKey; hintKey: TKey; cls: string }> = {
  recommended: { labelKey: "app.risk.recommended", hintKey: "app.risk.recommendedHint", cls: "bg-emerald-50 text-emerald-600" },
  safe: { labelKey: "app.risk.safe", hintKey: "app.risk.safeHint", cls: "bg-sky-50 text-sky-600" },
  advanced: { labelKey: "app.risk.advanced", hintKey: "app.risk.advancedHint", cls: "bg-amber-50 text-amber-700" },
};

export function AppManagerTab() {
  const { push, run } = useLog();
  const { device } = useDevice();
  const { t } = useI18n();
  const am = useAppManager();
  const {
    all, disabled, launchable, query, kind, selected, marketStatus,
    setAll, setDisabled, setLaunchable, setQuery, setKind, setSelected, setMarketStatus,
    dbId, db, riskFilter, checked, dryRun, debloatIndex,
    setDbId, setDb, setRiskFilter, setChecked, setDryRun, setDebloatIndex,
  } = am;
  const [loading, setLoading] = useState(false);
  const [reinstall, setReinstall] = useState(true);
  const [grantPerms, setGrantPerms] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);

  function guard(): boolean {
    if (!device.connected || device.mode !== "adb") {
      push("No device connected in ADB mode.", "stderr");
      return false;
    }
    return true;
  }

  // ── scan: installed apps + build debloat risk index from all DBs ──────────
  async function scan() {
    if (!guard()) return;
    setLoading(true);
    push("Scanning apps + debloat status…", "system");
    try {
      const [inst, dis, launcherDump, xi, uni, tv] = await Promise.all([
        listInstalledPackages(),
        listDisabledPackages(),
        runCapture("adb", [
          "shell", "cmd", "package", "query-activities", "--brief",
          "-a", "android.intent.action.MAIN",
          "-c", "android.intent.category.LAUNCHER",
        ]),
        loadDebloatDb("xiaomi").catch(() => null),
        loadDebloatDb("universal").catch(() => null),
        loadDebloatDb("tv").catch(() => null),
      ]);
      setAll(inst.sort((a, b) => a.localeCompare(b)));
      setDisabled(new Set(dis));
      const launch = parseLaunchable(launcherDump);
      setLaunchable(launch);
      const dbs = [xi, uni, tv].filter(Boolean) as DebloatDatabase[];
      const idx = buildDebloatIndex(dbs);
      setDebloatIndex(idx);
      const flagged = inst.filter((p) => idx.has(p)).length;
      push(
        `${inst.length} apps: ${launch.size} user, ${inst.length - launch.size} background, ` +
          `${dis.length} disabled, ${flagged} in debloat list.`,
        "system",
      );
      await readMarketStatus();
    } catch (e) {
      push(String(e), "stderr");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = all;
    if (q) {
      list = all.filter(
        (p) => p.toLowerCase().includes(q) || deriveAppName(p).toLowerCase().includes(q),
      );
    }
    if (kind === "menu") list = list.filter((p) => launchable.has(p));
    else list = list.filter((p) => !launchable.has(p));
    return list.slice(0, 300);
  }, [all, query, kind, launchable]);

  async function installApk() {
    if (!guard()) return;
    const picked = await open({
      multiple: true,
      filters: [{ name: "Android App", extensions: ["apk"] }],
    });
    const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (files.length === 0) return;
    const flags: string[] = [];
    if (reinstall) flags.push("-r");
    if (grantPerms) flags.push("-g");
    push(t("app.install.working"), "system");
    // single file → install ; multiple → install-multiple (split APK app)
    const cmd = files.length > 1 ? "install-multiple" : "install";
    run("adb", [cmd, ...flags, ...files]);
  }

  async function uninstallApp(pkg: string) {
    await act(["pm", "uninstall", "--user", "0", pkg], `Uninstalling ${pkg}…`);
    // refresh the installed set after removal
    try {
      const inst = await listInstalledPackages();
      setAll(inst.sort((a, b) => a.localeCompare(b)));
    } catch { /* ignore */ }
  }

  async function openAppInfo(pkg: string) {
    if (!guard()) return;
    push(`Opening App info for ${pkg}…`, "system");
    run("adb", [
      "shell", "am", "start",
      "-a", "android.settings.APPLICATION_DETAILS_SETTINGS",
      "-d", `package:${pkg}`,
    ]);
  }

  async function extractApk(pkg: string) {
    if (!guard()) return;
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") {
      push(t("app.extractNoFolder"), "stderr");
      return;
    }
    push(t("app.extractWorking", { dir }), "system");
    try {
      const pathOut = await runCapture("adb", ["shell", "pm", "path", pkg]);
      const apks = pathOut
        .split("\n")
        .map((l) => l.replace(/^package:/, "").trim())
        .filter((l) => l.endsWith(".apk"));
      if (apks.length === 0) {
        push("No APK path found.", "stderr");
        return;
      }
      for (const apk of apks) {
        const base = apk.split("/").pop() || "base.apk";
        const dest = `${dir}/${pkg}-${base}`;
        run("adb", ["pull", apk, dest]);
      }
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function act(args: string[], msg: string) {
    if (!guard()) return;
    push(msg, "system");
    try {
      const out = await runCapture("adb", ["shell", ...args]);
      if (out.trim()) push(out.trim(), "stdout");
      push("✓ done.", "system");
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  async function showInfo(pkg: string) {
    if (!guard()) return;
    push(`── Info: ${pkg} (${deriveAppName(pkg)}) ──`, "system");
    try {
      const [ver, path] = await Promise.all([
        runCapture("adb", ["shell", "dumpsys", "package", pkg]),
        runCapture("adb", ["shell", "pm", "path", pkg]),
      ]);
      const get = (re: RegExp) => re.exec(ver)?.[1]?.trim() ?? "—";
      push(`versionName: ${get(/versionName=([^\s]+)/)}`, "stdout");
      push(`versionCode: ${get(/versionCode=([0-9]+)/)}`, "stdout");
      push(`targetSdk: ${get(/targetSdk=([0-9]+)/)}`, "stdout");
      push(`installer: ${get(/installerPackageName=([^\s]+)/)}`, "stdout");
      push(`disabled: ${disabled.has(pkg) ? "yes" : "no"}`, "stdout");
      const paths = path.split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(Boolean);
      paths.forEach((p) => push(`APK: ${p}`, "stdout"));
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  const sel = selected;

  async function readMarketStatus() {
    if (!device.connected || device.mode !== "adb") return;
    try {
      const dump = await runCapture("adb", ["shell", "dumpsys", "package", "com.android.vending"]);
      const disabledByUs = /disabledComponents:[\s\S]*?MarketDeepLinkHandlerActivity/.test(dump);
      setMarketStatus(disabledByUs ? "blocked" : "active");
    } catch {
      setMarketStatus("unknown");
    }
  }

  useEffect(() => {
    readMarketStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.connected, device.mode]);

  async function toggleMarketHandler(disable: boolean) {
    if (!guard()) return;
    push(disable ? "Blocking Play Store opener…" : "Restoring Play Store opener…", "system");
    try {
      const sub = disable ? "disable" : "enable";
      const out = await runCapture("adb", ["shell", "pm", sub, MARKET_HANDLER]);
      if (out.trim()) push(out.trim(), "stdout");
      push(disable ? "✓ blocked." : "✓ restored.", "system");
      await readMarketStatus();
    } catch (e) {
      push(String(e), "stderr");
    }
  }

  // ── debloat database (bottom section) ─────────────────────────────────────
  async function loadDb(id: DbId) {
    setDbLoading(true);
    try {
      setDb(await loadDebloatDb(id));
      setChecked(new Set());
    } catch (e) {
      push(String(e), "stderr");
      setDb(null);
    } finally {
      setDbLoading(false);
    }
  }
  useEffect(() => {
    loadDb(dbId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbId]);

  const dbEntries = useMemo(() => {
    if (!db) return [];
    // A package can appear under several brand categories — dedupe by package,
    // keeping the riskiest classification. Duplicate React keys otherwise cause
    // stale rows to linger when switching the risk filter.
    const rank: Record<RiskLevel, number> = { recommended: 0, safe: 1, advanced: 2 };
    const byPkg = new Map<string, { package: string; label: string; description: string; safe: boolean; risk: RiskLevel }>();
    for (const c of db.categories) {
      for (const e of c.entries) {
        const risk = riskOf(e.description, e.safe);
        const prev = byPkg.get(e.package);
        if (!prev || rank[risk] > rank[prev.risk]) {
          byPkg.set(e.package, {
            package: e.package,
            label: e.label,
            description: e.description,
            safe: e.safe,
            risk,
          });
        }
      }
    }
    return [...byPkg.values()]
      .filter((e) => e.risk === riskFilter)
      .sort((a, b) => (a.label || a.package).localeCompare(b.label || b.package));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, riskFilter]);

  function riskOf(desc: string | undefined, safe: boolean): RiskLevel {
    if (safe === false) return "advanced";
    const d = (desc || "").toLowerCase();
    if (d.includes("advanced") || d.includes("expert") || d.includes("unsafe") || d.includes("keep")) {
      return "advanced";
    }
    if (d.includes("recommended")) return "recommended";
    // "safe", "optional", and anything else safe-by-flag → safe
    return "safe";
  }

  // which risk levels actually have entries in the current DB
  const availableRisks = useMemo(() => {
    const set = new Set<RiskLevel>();
    if (db) {
      for (const c of db.categories) {
        for (const e of c.entries) set.add(riskOf(e.description, e.safe));
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  // if the selected risk filter has no entries in this DB, move to one that does
  useEffect(() => {
    if (!db) return;
    if (!availableRisks.has(riskFilter)) {
      const order: RiskLevel[] = ["recommended", "safe", "advanced"];
      const next = order.find((r) => availableRisks.has(r));
      if (next) setRiskFilter(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, availableRisks]);

  function toggleChecked(pkg: string) {
    const n = new Set(checked);
    n.has(pkg) ? n.delete(pkg) : n.add(pkg);
    setChecked(n);
  }
  function selectAllPresent() {
    // Check every entry currently shown in the list (respecting the active
    // database + risk filter). Install/active state is indicated per-row by the
    // status dot; disabling an absent/already-off package is simply a no-op.
    const next = new Set(checked);
    for (const e of dbEntries) next.add(e.package);
    setChecked(next);
  }
  function unselectAllShown() {
    // Uncheck only the entries currently shown (respects the active filter).
    const next = new Set(checked);
    for (const e of dbEntries) next.delete(e.package);
    setChecked(next);
  }
  function applyDebloat(enable: boolean) {
    const pkgs = [...checked];
    if (pkgs.length === 0) {
      push("No packages checked.", "stderr");
      return;
    }
    if (dryRun) {
      push(`[DRY-RUN] Would ${enable ? "enable" : "disable"} ${pkgs.length} packages:`, "system");
      pkgs.forEach((p) => push(`  · ${p}`, "system"));
      return;
    }
    pkgs.forEach((p) => {
      const sub = enable ? ["enable", p] : ["disable-user", "--user", "0", p];
      runCapture("adb", ["shell", "pm", ...sub]).catch((e) => push(String(e), "stderr"));
    });
    push(`${enable ? "Enabled" : "Disabled"} ${pkgs.length} packages via adb.`, "system");
  }

  function dbStatusOf(pkg: string): "on" | "off" | "absent" {
    if (disabled.has(pkg)) return "off";
    if (all.length > 0 && !all.includes(pkg)) return "absent";
    return "on";
  }

  return (
    <>
      <TabHelp>{t("app.help")}</TabHelp>

      {/* Play Store opener blocker */}
      <Section title={t("app.market.title")}>
        <div className="mb-1 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
          <Store size={14} className="mt-[1px] shrink-0" />
          <span>{t("app.market.desc")}</span>
        </div>
        <div className="mb-1 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px]">
          <span className="text-[var(--color-ink-faint)]">{t("app.market.status")}</span>
          {marketStatus === "blocked" ? (
            <span className="flex items-center gap-1.5 font-semibold text-[var(--color-danger-600)]">
              <span className="h-2 w-2 rounded-full bg-[var(--color-danger)]" />
              {t("app.market.blocked")}
            </span>
          ) : marketStatus === "active" ? (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t("app.market.active")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-medium text-[var(--color-ink-faint)]">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              {t("app.market.unknown")}
            </span>
          )}
          <button
            title={t("app.market.recheck")}
            onClick={readMarketStatus}
            className="no-drag ml-auto rounded-md p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <Row>
          <Button variant="danger" disabled={marketStatus === "blocked"} title={t("app.market.blockHint")} onClick={() => toggleMarketHandler(true)}>
            {t("common.block")}
          </Button>
          <Button variant="success" disabled={marketStatus === "active"} title={t("app.market.restoreHint")} onClick={() => toggleMarketHandler(false)}>
            {t("common.restore")}
          </Button>
        </Row>
      </Section>

      {/* install APK */}
      <Section title={t("app.install.title")}>
        <div className="mb-1 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] leading-snug text-sky-800">
          <PackagePlus size={14} className="mt-[1px] shrink-0" />
          <span>{t("app.install.desc")}</span>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]" title={t("app.install.reinstallHint")}>
          <input type="checkbox" checked={reinstall} onChange={(e) => setReinstall(e.target.checked)} className="accent-[var(--color-brand)]" />
          {t("app.install.reinstall")}
        </label>
        <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]" title={t("app.install.grantHint")}>
          <input type="checkbox" checked={grantPerms} onChange={(e) => setGrantPerms(e.target.checked)} className="accent-[var(--color-brand)]" />
          {t("app.install.grant")}
        </label>
        <Button size="block" variant="primary" title={t("app.install.pickHint")} onClick={installApk}>
          <PackagePlus size={14} />
          {t("app.install.pick")}
        </Button>
        <p className="text-[10px] leading-snug text-[var(--color-ink-faint)]">{t("app.install.bundleNote")}</p>
      </Section>

      {/* installed app list */}
      <Section title={t("app.list.title")}>
        <Button size="block" disabled={loading} title={t("app.list.loadHint")} onClick={scan}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {loading ? t("common.loading") : t("app.list.load")}
        </Button>

        {all.length > 0 && (
          <div className="grid grid-cols-5 gap-1 text-center">
            {([
              { k: "app.stats.total", v: all.length },
              { k: "app.stats.user", v: launchable.size },
              { k: "app.stats.system", v: all.length - launchable.size },
              { k: "app.stats.disabled", v: disabled.size },
              { k: "app.stats.debloat", v: all.filter((p) => debloatIndex.has(p)).length },
            ] as { k: TKey; v: number }[]).map((s) => (
              <div key={s.k} className="rounded-md bg-[var(--color-surface-2)] px-1 py-1.5">
                <div className="text-[13px] font-bold text-[var(--color-ink)]">{s.v}</div>
                <div className="text-[8.5px] leading-tight text-[var(--color-ink-faint)]">{t(s.k)}</div>
              </div>
            ))}
          </div>
        )}

        {all.length > 0 && (
          <>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("app.search")}
                className="no-drag w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-3 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
              />
            </div>

            <div className="flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
              {([
                { id: "menu", labelKey: "app.filter.menu", hintKey: "app.filter.menuHint" },
                { id: "bg", labelKey: "app.filter.bg", hintKey: "app.filter.bgHint" },
              ] as const).map((k) => (
                <button
                  key={k.id}
                  title={t(k.hintKey)}
                  onClick={() => setKind(k.id)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    kind === k.id ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {t(k.labelKey)}
                </button>
              ))}
            </div>

            <div className="max-h-[240px] overflow-auto rounded-lg border border-[var(--color-border)]">
              {filtered.map((pkg) => {
                const hit = debloatIndex.get(pkg);
                const name = deriveAppName(pkg);
                return (
                  <button
                    key={pkg}
                    onClick={() => setSelected(pkg)}
                    title={pkg}
                    className={`flex w-full items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-left last:border-0 transition-colors ${
                      selected === pkg ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--color-bg)]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] font-medium ${selected === pkg ? "text-[var(--color-brand-600)]" : "text-[var(--color-ink)]"}`}>
                        {name}
                      </span>
                      <span className="block truncate font-mono text-[9.5px] text-[var(--color-ink-faint)]">
                        {pkg}
                      </span>
                    </span>
                    {hit && (
                      <span
                        title={t(RISK_META[hit.risk].hintKey)}
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${RISK_META[hit.risk].cls}`}
                      >
                        {t(RISK_META[hit.risk].labelKey)}
                      </span>
                    )}
                    {!launchable.has(pkg) && (
                      <span title={t("app.badge.bg")} className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                        BG
                      </span>
                    )}
                    {disabled.has(pkg) && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                        {t("common.off")}
                      </span>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">{t("app.noMatch")}</div>
              )}
            </div>
            {all.length > filtered.length && (
              <div className="text-[10px] text-[var(--color-ink-faint)]">
                {t("app.showing", { shown: filtered.length, total: all.length })}
              </div>
            )}
          </>
        )}
      </Section>

      {/* actions for selected app */}
      {sel && (
        <Section title={t("app.actions.title")}>
          <div className="mb-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5">
            <span className="block text-[12px] font-semibold text-[var(--color-ink)]">{deriveAppName(sel)}</span>
            <span className="block break-all font-mono text-[10px] text-[var(--color-ink-faint)]">{sel}</span>
          </div>
          <Button size="block" variant="info" title={t("app.infoHint")} onClick={() => showInfo(sel)}>
            {t("app.info")}
          </Button>
          <Row>
            <Button title={t("app.openHint")} onClick={() => act(["monkey", "-p", sel, "-c", "android.intent.category.LAUNCHER", "1"], `Launching ${sel}…`)}>
              {t("app.open")}
            </Button>
            <Button title={t("app.stopHint")} onClick={() => act(["am", "force-stop", sel], `Force-stopping ${sel}…`)}>
              {t("app.stop")}
            </Button>
          </Row>
          <Row>
            <Button title={t("app.cacheHint")} onClick={() => act(["pm", "clear", "--cache-only", sel], `Clearing cache ${sel}…`)}>
              {t("app.cache")}
            </Button>
            <Button variant="danger" title={t("app.dataHint")} onClick={() => act(["pm", "clear", sel], `Clearing data ${sel}…`)}>
              {t("app.data")}
            </Button>
          </Row>
          <Row>
            <Button variant="danger" title={t("app.disableHint")} onClick={() => act(["pm", "disable-user", "--user", "0", sel], `Disabling ${sel}…`)}>
              {t("app.disable")}
            </Button>
            <Button variant="success" title={t("app.enableHint")} onClick={() => act(["pm", "enable", sel], `Enabling ${sel}…`)}>
              {t("app.enable")}
            </Button>
          </Row>
          <Row>
            <Button title={t("app.appInfoHint")} onClick={() => openAppInfo(sel)}>
              {t("app.appInfo")}
            </Button>
            <Button title={t("app.extractHint")} onClick={() => extractApk(sel)}>
              {t("app.extract")}
            </Button>
          </Row>
          <Button size="block" variant="danger" title={t("app.uninstallHint")} onClick={() => uninstallApp(sel)}>
            {t("app.uninstall")}
          </Button>
        </Section>
      )}

      {/* ── DEBLOAT SECTION (bottom) ─────────────────────────────────────── */}
      <Section title={t("app.debloat.title")}>
        <TabHelp>{t("app.debloat.help")}</TabHelp>

        {/* database selector (brand) */}
        <div className="mb-2 flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
          {DB_TABS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDbId(d.id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                dbId === d.id ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>

        {/* risk filter */}
        <div className="mb-2 flex gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
          {([
            { id: "recommended", labelKey: "app.risk.recommended", hintKey: "app.risk.recommendedHint" },
            { id: "safe", labelKey: "app.risk.safe", hintKey: "app.risk.safeHint" },
            { id: "advanced", labelKey: "app.risk.advanced", hintKey: "app.risk.advancedHint" },
          ] as { id: RiskFilter; labelKey: TKey; hintKey: TKey }[]).map((r) => {
            const avail = availableRisks.has(r.id);
            return (
            <button
              key={r.id}
              title={t(r.hintKey)}
              disabled={!avail}
              onClick={() => setRiskFilter(r.id)}
              className={`flex-1 rounded-md px-1.5 py-1.5 text-[10.5px] font-medium transition-colors disabled:opacity-40 ${
                riskFilter === r.id ? "bg-[var(--color-surface)] text-[var(--color-brand-600)] shadow-sm" : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t(r.labelKey)}
            </button>
            );
          })}
        </div>

        <div className="mb-1 flex gap-2">
          <Button size="sm" className="flex-1" title={t("app.debloat.selectAllHint")} onClick={selectAllPresent}>
            {t("app.debloat.selectAll")}
          </Button>
          <Button size="sm" className="flex-1" title={t("app.debloat.unselectAllHint")} onClick={unselectAllShown}>
            {t("app.debloat.unselectAll")}
          </Button>
          <Button size="sm" variant="danger" title={t("app.debloat.resetHint")} onClick={() => setChecked(new Set())}>
            {t("app.debloat.reset")}
          </Button>
        </div>

        <label className="mb-2 flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]" title={t("app.debloat.dryRunHint")}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-[var(--color-brand)]" />
          {t("app.debloat.dryRun")}
        </label>

        <div
          key={`${dbId}-${riskFilter}`}
          className="mb-2 max-h-[240px] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          {dbLoading ? (
            <div className="p-4 text-sm text-[var(--color-ink-faint)]">{t("app.debloat.loading")}</div>
          ) : !db ? (
            <div className="p-4 text-sm text-[var(--color-danger-600)]">{t("app.debloat.notFound", { id: dbId })}</div>
          ) : dbEntries.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-ink-faint)]">{t("app.debloat.empty")}</div>
          ) : (
            dbEntries.map((e) => {
              const st = dbStatusOf(e.package);
              return (
                <label
                  key={e.package}
                  className="flex cursor-pointer items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 last:border-0 hover:bg-[var(--color-bg)]"
                >
                  <input type="checkbox" checked={checked.has(e.package)} onChange={() => toggleChecked(e.package)} className="accent-[var(--color-brand)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-[var(--color-ink)]">{e.label || deriveAppName(e.package)}</span>
                    <span className="block truncate font-mono text-[9.5px] text-[var(--color-ink-faint)]">{e.package}</span>
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${RISK_META[e.risk].cls}`}>
                    {t(RISK_META[e.risk].labelKey)}
                  </span>
                  <StatusDot status={st} />
                </label>
              );
            })
          )}
        </div>

        <Row>
          <Button variant="danger" title={t("app.debloat.disableHint")} onClick={() => applyDebloat(false)}>
            {t("app.disable")}
          </Button>
          <Button variant="success" title={t("app.debloat.restoreHint")} onClick={() => applyDebloat(true)}>
            {t("app.enable")}
          </Button>
        </Row>
        <div className="mt-1 text-center text-[11px] text-[var(--color-ink-faint)]">
          {t("app.debloat.selectedCount", { n: checked.size })}
        </div>
        {db && <div className="mt-2 text-[11px] text-[var(--color-ink-faint)]">{t("app.debloat.source", { src: db.source })}</div>}
      </Section>
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
    <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--color-ink-faint)]">
      <span className={`h-2 w-2 rounded-full ${c}`} />
      {t}
    </span>
  );
}

function parseLaunchable(dump: string): Set<string> {
  const set = new Set<string>();
  for (const raw of dump.split("\n")) {
    const line = raw.trim();
    const m = /([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+/.exec(line);
    if (m && m[1].includes(".")) set.add(m[1]);
  }
  return set;
}
