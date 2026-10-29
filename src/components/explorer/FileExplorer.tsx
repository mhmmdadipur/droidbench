import { useEffect, useMemo, useRef, useState } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronLeft,
  Search,
  Download as DownloadIcon,
  Copy,
  Check,
  CornerDownLeft,
  CaseSensitive,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../../i18n";
import { useLog } from "../../state/log";
import {
  listDir,
  readDeviceFile,
  searchFiles,
  searchText,
  type FsEntry,
} from "../../lib/diagnostics";

const QUICK_PATHS = [
  "/data/adb/modules",
  "/data/adb",
  "/sdcard",
  "/sdcard/Download",
  "/system",
  "/",
];

/** macOS-style traffic-light button (matches the main window). */
function Light({
  color,
  hover,
  glyph,
  onClick,
  title,
}: {
  color: string;
  hover: string;
  glyph: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="no-drag group flex h-3 w-3 items-center justify-center rounded-full"
      style={{ backgroundColor: color }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = color)}
    >
      <span className="text-[8px] font-bold leading-none text-black/55 opacity-0 group-hover:opacity-100">
        {glyph}
      </span>
    </button>
  );
}

export function FileExplorer() {
  const { t } = useI18n();
  const { push, run } = useLog();

  const [path, setPath] = useState("/data/adb/modules");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"none" | "name" | "text">("none");

  // open file
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(true);

  // in-file text search
  const [find, setFind] = useState("");
  const [caseSens, setCaseSens] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const preRef = useRef<HTMLDivElement>(null);

  async function load(p: string) {
    setLoading(true);
    setSearchMode("none");
    try {
      setEntries(await listDir(p));
      setPath(p);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinPath(base: string, name: string) {
    return base.endsWith("/") ? base + name : `${base}/${name}`;
  }
  function parentOf(p: string) {
    const trimmed = p.replace(/\/+$/, "");
    const idx = trimmed.lastIndexOf("/");
    return idx <= 0 ? "/" : trimmed.slice(0, idx);
  }
  function entryPath(e: FsEntry) {
    return e.fullPath || joinPath(path, e.name);
  }

  async function openEntry(e: FsEntry) {
    const full = entryPath(e);
    if (e.isDir) {
      load(full);
      return;
    }
    setLoading(true);
    try {
      const content = await readDeviceFile(full);
      const nonPrintable = (content.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
      setOpenPath(full);
      setBody(nonPrintable > content.length * 0.3 ? "" : content);
      setFind("");
      setMatchIdx(0);
    } finally {
      setLoading(false);
    }
  }

  async function doSearchName() {
    if (!nameQuery.trim()) return;
    setLoading(true);
    try {
      setEntries(await searchFiles(path, nameQuery.trim()));
      setSearchMode("name");
    } finally {
      setLoading(false);
    }
  }
  async function doSearchText() {
    if (!nameQuery.trim()) return;
    setLoading(true);
    try {
      setEntries(await searchText(path, nameQuery.trim()));
      setSearchMode("text");
    } finally {
      setLoading(false);
    }
  }

  async function pull(targetPath: string, name: string) {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    push(t("diag.fs.pulling", { name, dir }), "system");
    run("adb", ["pull", targetPath, `${dir}/${name}`]);
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  // in-file search: compute match ranges + highlighted segments
  const { segments, matchCount } = useMemo(() => {
    if (!find.trim()) return { segments: [{ text: body, hit: false }], matchCount: 0 };
    const flags = caseSens ? "g" : "gi";
    let re: RegExp;
    try {
      re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      return { segments: [{ text: body, hit: false }], matchCount: 0 };
    }
    const segs: { text: string; hit: boolean }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(body))) {
      if (m.index > last) segs.push({ text: body.slice(last, m.index), hit: false });
      segs.push({ text: m[0], hit: true });
      last = m.index + m[0].length;
      count++;
      if (m[0].length === 0) re.lastIndex++;
      if (count > 5000) break;
    }
    if (last < body.length) segs.push({ text: body.slice(last), hit: false });
    return { segments: segs, matchCount: count };
  }, [body, find, caseSens]);

  // scroll to the current match
  useEffect(() => {
    if (!find.trim() || !preRef.current) return;
    const marks = preRef.current.querySelectorAll("[data-hit='1']");
    const el = marks[matchIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [matchIdx, find, segments]);

  function nextMatch() {
    if (matchCount === 0) return;
    setMatchIdx((i) => (i + 1) % matchCount);
  }

  let hitSeen = -1;

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      {/* title bar — traffic lights, matches the main window */}
      <div
        data-tauri-drag-region
        className="drag flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4"
      >
        <div className="no-drag flex items-center gap-2">
          <Light title={t("title.close")} color="#ff5f57" hover="#ff3b30" glyph="✕" onClick={() => getCurrentWindow().close()} />
          <Light title={t("title.minimize")} color="#febc2e" hover="#ffb000" glyph="–" onClick={() => getCurrentWindow().minimize()} />
          <Light title={t("title.zoom")} color="#28c840" hover="#1aad2b" glyph="+" onClick={() => getCurrentWindow().toggleMaximize()} />
        </div>
        <div className="ml-2 flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--color-brand)] text-[11px] font-bold text-white">
            D
          </div>
          <FolderOpen size={14} className="text-[var(--color-brand-600)]" />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
            {t("explorer.title")}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* LEFT: tree + search */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* quick paths */}
          <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] p-2">
            {QUICK_PATHS.map((q) => (
              <button
                key={q}
                onClick={() => load(q)}
                className={`no-drag rounded px-1.5 py-0.5 font-mono text-[9.5px] ${
                  path === q
                    ? "bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"
                    : "bg-[var(--color-surface-2)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {/* path bar */}
          <div className="flex items-center gap-1 border-b border-[var(--color-border)] p-2">
            <button
              onClick={() => load(parentOf(path))}
              title={t("diag.fs.up")}
              className="no-drag flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)]"
            >
              <ChevronLeft size={12} />
            </button>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(path)}
              className="no-drag min-w-0 flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-ink)] outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
            />
            <button
              onClick={() => pull(path, path.replace(/\/+$/, "").split("/").pop() || "folder")}
              title={t("diag.fs.pullFolderHint")}
              className="no-drag rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-2)]"
            >
              <DownloadIcon size={12} />
            </button>
          </div>

          {/* file name/text search */}
          <div className="border-b border-[var(--color-border)] p-2">
            <div className="relative mb-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
              <input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearchName()}
                placeholder={t("explorer.searchPlaceholder")}
                className="no-drag w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 pl-7 pr-2 text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
              />
            </div>
            <div className="flex gap-1">
              <button onClick={doSearchName} className="no-drag flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-[10px] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
                {t("diag.fs.searchNameBtn")}
              </button>
              <button onClick={doSearchText} className="no-drag flex-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-[10px] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
                {t("diag.fs.searchTextBtn")}
              </button>
            </div>
            {searchMode !== "none" && (
              <div className="mt-1 flex items-center justify-between text-[9.5px] text-[var(--color-ink-faint)]">
                <span>{t("diag.fs.results", { n: entries.length })}</span>
                <button onClick={() => load(path)} className="no-drag underline hover:text-[var(--color-ink)]">
                  {t("diag.fs.clearSearch")}
                </button>
              </div>
            )}
          </div>

          {/* tree */}
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">{t("common.loading")}</div>
            ) : entries.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-[var(--color-ink-faint)]">{t("diag.fs.empty")}</div>
            ) : (
              entries.map((e) => {
                const full = entryPath(e);
                const active = openPath === full;
                return (
                  <div
                    key={full}
                    className={`group flex items-center gap-2 px-3 py-1.5 text-[11.5px] ${
                      active ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--color-bg)]"
                    }`}
                  >
                    <button onClick={() => openEntry(e)} className="no-drag flex min-w-0 flex-1 items-center gap-2 text-left">
                      {e.isDir ? (
                        <Folder size={13} className="shrink-0 text-amber-500" />
                      ) : (
                        <FileText size={13} className={`shrink-0 ${active ? "text-[var(--color-brand-600)]" : "text-[var(--color-ink-faint)]"}`} />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono text-[var(--color-ink)]" title={full}>
                        {searchMode !== "none" && e.fullPath ? e.fullPath : e.name}
                      </span>
                    </button>
                    {!e.isDir && e.size != null && (
                      <span className="shrink-0 text-[9px] text-[var(--color-ink-faint)]">{e.size} B</span>
                    )}
                    <button
                      onClick={() => pull(full, e.name)}
                      title={t("diag.fs.pullHint")}
                      className="no-drag shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] opacity-0 hover:text-[var(--color-ink)] group-hover:opacity-100"
                    >
                      <DownloadIcon size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: editor */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
          {openPath ? (
            <>
              {/* file header + in-file search */}
              <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
                <FileText size={13} className="shrink-0 text-[var(--color-brand-600)]" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-ink)]" title={openPath}>
                  {openPath}
                </span>
                <button onClick={() => setWrap((w) => !w)} title={t("diag.fs.wrap")} className={`no-drag rounded px-1.5 py-0.5 text-[9px] font-semibold ${wrap ? "bg-[var(--color-brand-50)] text-[var(--color-brand-600)]" : "text-[var(--color-ink-soft)] hover:bg-[var(--color-bg)]"}`}>↵</button>
                <button onClick={copyBody} title={t("diag.fs.copy")} className="no-drag rounded p-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-bg)]">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <button onClick={() => pull(openPath!, openPath!.split("/").pop() || "file")} title={t("diag.fs.pullHint")} className="no-drag rounded p-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-bg)]">
                  <DownloadIcon size={13} />
                </button>
              </div>

              {/* in-file text search bar */}
              <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
                <div className="relative flex-1">
                  <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                  <input
                    value={find}
                    onChange={(e) => { setFind(e.target.value); setMatchIdx(0); }}
                    onKeyDown={(e) => e.key === "Enter" && nextMatch()}
                    placeholder={t("explorer.findInFile")}
                    className="no-drag w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] py-1 pl-7 pr-2 text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
                  />
                </div>
                <button onClick={() => setCaseSens((c) => !c)} title="Aa" className={`no-drag rounded p-1 ${caseSens ? "bg-[var(--color-brand-50)] text-[var(--color-brand-600)]" : "text-[var(--color-ink-soft)] hover:bg-[var(--color-bg)]"}`}>
                  <CaseSensitive size={14} />
                </button>
                <span className="min-w-[48px] text-center text-[10px] text-[var(--color-ink-faint)]">
                  {matchCount > 0 ? `${matchIdx + 1}/${matchCount}` : `0/0`}
                </span>
                <button onClick={nextMatch} title={t("explorer.next")} className="no-drag rounded p-1 text-[var(--color-ink-soft)] hover:bg-[var(--color-bg)]">
                  <CornerDownLeft size={13} />
                </button>
              </div>

              <div
                ref={preRef}
                className={`min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-[var(--color-ink)] ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
              >
                {body ? (
                  segments.map((s, i) => {
                    if (!s.hit) return <span key={i}>{s.text}</span>;
                    hitSeen++;
                    const isCurrent = hitSeen === matchIdx;
                    return (
                      <mark
                        key={i}
                        data-hit="1"
                        className={isCurrent ? "bg-amber-300 text-black" : "bg-amber-100 text-black"}
                      >
                        {s.text}
                      </mark>
                    );
                  })
                ) : (
                  <span className="text-[var(--color-ink-faint)]">{t("diag.fs.binary")}</span>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-ink-faint)]">
              {t("explorer.pickFile")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
