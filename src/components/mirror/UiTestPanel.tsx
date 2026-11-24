import { useRef, useState } from "react";
import { ask, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Check, X, Play, Square, Circle, FileDown } from "lucide-react";
import { Button } from "../ui/Button";
import { AKEY, META } from "../../lib/mirrorKeys";
import type { UiTree } from "../../lib/uiInspector";
import {
  MAX_EXECUTED,
  PRESS_KEYS,
  centerOf,
  countSteps,
  findNode,
  parseScript,
  shownText,
  type TestStep,
} from "../../lib/uiTest";

const LS_TESTS = "droidbench.mirror.uitests";
const FIELD =
  "selectable w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]";
const WAIT_MS = 8000; // how long klik / isi / tunggu keep looking for the element
const CHECK_MS = 3000; // ada / tidak ada / cek: a short grace period for the screen to settle

interface SavedTest {
  id: string;
  name: string;
  script: string;
}
interface Result {
  line: number;
  ok: boolean;
  text: string;
  /** nesting level inside jika / ulangi blocks, for indentation */
  depth: number;
}

function loadTests(): SavedTest[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_TESTS) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is SavedTest =>
        typeof x === "object" && x !== null && typeof x.id === "string" && typeof x.name === "string" && typeof x.script === "string",
    );
  } catch {
    return [];
  }
}
function storeTests(list: SavedTest[]) {
  try {
    localStorage.setItem(LS_TESTS, JSON.stringify(list));
  } catch {
    /* storage unavailable: still usable for this session */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs a small script against the phone: each line looks up an element in a fresh UI dump
 * (by resource-id, else label, else text), then taps it, types into it, or checks it. Stops
 * at the first line that fails. The parent supplies the phone actions.
 */
export function UiTestPanel({
  script,
  setScript,
  recording,
  onToggleRecord,
  live,
  onDump,
  onTap,
  onKey,
  onType,
  onFocusPhone,
  onScreenshot,
  deviceName,
}: {
  /** the script text lives in the parent so the inspector / recorder can add lines to it */
  script: string;
  setScript: (s: string) => void;
  recording: boolean;
  onToggleRecord: () => void;
  live: boolean;
  onDump: () => Promise<UiTree>;
  onTap: (nx: number, ny: number) => Promise<void>;
  onKey: (keycode: number, meta?: number) => Promise<void>;
  onType: (text: string) => Promise<void>;
  onFocusPhone: () => void;
  /** save a screenshot of the phone and return its file path (used when a step fails) */
  onScreenshot: () => Promise<string>;
  /** shown in the exported report */
  deviceName: string;
}) {
  const [saved, setSaved] = useState<SavedTest[]>(loadTests);
  const [current, setCurrent] = useState(""); // id of the loaded saved test
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [summary, setSummary] = useState("");
  const cancel = useRef(false);
  const shotPath = useRef("");
  const startedAt = useRef(0);

  function stopped() {
    if (cancel.current) throw new Error("dihentikan");
  }
  /** Poll fresh dumps until the element is present (or absent). Returns the tree + match. */
  async function locate(target: string, present: boolean, timeoutMs: number) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      stopped();
      const tree = await onDump();
      const hit = findNode(tree, target);
      if (present === (hit != null)) return { tree, hit };
      if (Date.now() >= end) {
        throw new Error(present ? `elemen "${target}" tidak ditemukan` : `elemen "${target}" masih ada`);
      }
      await sleep(500);
    }
  }
  async function exec(s: TestStep): Promise<string> {
    switch (s.kind) {
      case "jeda":
        await sleep(s.ms);
        return `jeda ${s.ms / 1000} detik`;
      case "tunggu": {
        await locate(s.target, true, WAIT_MS);
        return `${s.target} muncul`;
      }
      case "ada": {
        await locate(s.target, true, CHECK_MS);
        return `${s.target} ada`;
      }
      case "tidakada": {
        await locate(s.target, false, CHECK_MS);
        return `${s.target} tidak ada`;
      }
      case "cek": {
        const { hit } = await locate(s.target, true, CHECK_MS);
        const got = shownText(hit!.node);
        if (got !== s.value) throw new Error(`${s.target}: isinya "${got}", seharusnya "${s.value}"`);
        return `${s.target} = "${got}"`;
      }
      case "tekan": {
        await onKey(PRESS_KEYS[s.value]);
        await sleep(300);
        return `tekan ${s.value}`;
      }
      case "klik": {
        const { tree, hit } = await locate(s.target, true, WAIT_MS);
        const c = centerOf(tree, hit!.node);
        await onTap(c.nx, c.ny);
        await sleep(400);
        return `klik ${s.target} (${hit!.by})`;
      }
      case "isi": {
        const { tree, hit } = await locate(s.target, true, WAIT_MS);
        const c = centerOf(tree, hit!.node);
        await onTap(c.nx, c.ny); // focus the field
        await sleep(350);
        stopped();
        await onKey(AKEY.A, META.CTRL_ON); // select what is there so the new text replaces it
        await sleep(120);
        if (s.value) await onType(s.value);
        else await onKey(AKEY.DEL);
        await sleep(300);
        return `isi ${s.target} (${hit!.by})`;
      }
      default:
        throw new Error(`langkah tidak dikenal: ${s.kind}`);
    }
  }

  /** Run a list of steps (and the blocks inside them). Throws at the first failing step. */
  async function runSteps(steps: TestStep[], depth: number, ctx: { done: number }): Promise<void> {
    for (const st of steps) {
      stopped();
      const add = (ok: boolean, text: string) => setResults((r) => [...r, { line: st.line, ok, text, depth }]);
      if (ctx.done >= MAX_EXECUTED) throw new Error(`terlalu banyak langkah (batas ${MAX_EXECUTED})`);
      if (st.kind === "jika") {
        // look at the screen once, now: no waiting, that is what makes it a condition
        const present = findNode(await onDump(), st.target) != null;
        const yes = (st.cond === "ada") === present;
        ctx.done++;
        add(true, `jika ${st.cond === "ada" ? "ada" : "tidak ada"} ${st.target}: ${yes ? "ya" : "tidak"}`);
        await runSteps((yes ? st.body : st.elseBody) ?? [], depth + 1, ctx);
      } else if (st.kind === "ulangi") {
        for (let i = 1; i <= (st.count ?? 1); i++) {
          stopped();
          add(true, `ulangi ${i} dari ${st.count}`);
          await runSteps(st.body ?? [], depth + 1, ctx);
        }
        ctx.done++;
      } else {
        try {
          const text = await exec(st);
          ctx.done++;
          add(true, text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          add(false, msg);
          // keep a picture of what the phone showed when it failed
          if (msg !== "dihentikan") {
            try {
              shotPath.current = await onScreenshot();
              setResults((r) => [...r, { line: st.line, ok: true, text: `screenshot: ${shotPath.current}`, depth }]);
            } catch {
              /* no screenshot: the failure itself is already listed */
            }
          }
          throw e;
        }
      }
    }
  }

  async function run() {
    const parsed = parseScript(script);
    if (parsed.errors.length > 0) {
      setResults(parsed.errors.map((e) => ({ line: e.line, ok: false, text: e.message, depth: 0 })));
      setSummary("Skrip punya kesalahan, perbaiki dulu.");
      return;
    }
    if (parsed.steps.length === 0) {
      setSummary("Skrip kosong.");
      return;
    }
    cancel.current = false;
    shotPath.current = "";
    startedAt.current = Date.now();
    setRunning(true);
    setResults([]);
    setSummary("");
    const ctx = { done: 0 };
    let failed = false;
    try {
      await runSteps(parsed.steps, 0, ctx);
    } catch (e) {
      failed = true;
      // a failing leaf step already listed itself; block-level errors (limit, stop) are listed here
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "dihentikan" || msg.startsWith("terlalu banyak")) {
        setResults((r) => [...r, { line: 0, ok: false, text: msg, depth: 0 }]);
      }
    }
    const secs = ((Date.now() - startedAt.current) / 1000).toFixed(1);
    setSummary(
      failed
        ? `GAGAL setelah ${ctx.done} dari ${countSteps(parsed.steps)} langkah (${secs} dtk)`
        : `LULUS: ${ctx.done} langkah (${secs} dtk)`,
    );
    setRunning(false);
    onFocusPhone();
  }

  /** Save the last run (script, every step, the summary) as a text file. */
  async function exportReport() {
    const stamp = new Date(startedAt.current || Date.now()).toISOString();
    const body = [
      "Droidbench UI test report",
      `Test: ${name.trim() || "(unnamed)"}`,
      `Device: ${deviceName || "-"}`,
      `Started: ${stamp}`,
      `Result: ${summary}`,
      "",
      "Steps:",
      ...results.map((r) => `${"  ".repeat(r.depth)}${r.ok ? "OK  " : "FAIL"} ${r.line > 0 ? `[line ${r.line}] ` : ""}${r.text}`),
      "",
      "Script:",
      script.replace(/\s+$/, ""),
      "",
    ].join("\n");
    try {
      const path = await saveDialog({
        defaultPath: `ui-test-${stamp.slice(0, 19).replace(/[:T]/g, "-")}.txt`,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (path) await writeTextFile(path, body);
    } catch {
      /* the user can run again and retry */
    }
  }

  function save() {
    const n = name.trim();
    if (!n || !script.trim()) return;
    const existing = saved.find((x) => x.name === n);
    const id = existing?.id ?? `t${Date.now().toString(36)}`;
    const next = existing
      ? saved.map((x) => (x.id === id ? { ...x, script } : x))
      : [...saved, { id, name: n, script }];
    setSaved(next);
    storeTests(next);
    setCurrent(id);
  }
  async function remove() {
    const t = saved.find((x) => x.id === current);
    if (!t) return;
    const yes = await ask(`Hapus skrip tes "${t.name}"?`, { title: "Hapus skrip", kind: "warning" }).catch(() => false);
    if (!yes) return;
    const next = saved.filter((x) => x.id !== current);
    setSaved(next);
    storeTests(next);
    setCurrent("");
    setName("");
  }
  function pick(id: string) {
    setCurrent(id);
    const t = saved.find((x) => x.id === id);
    if (t) {
      setScript(t.script);
      setName(t.name);
    }
    setResults([]);
    setSummary("");
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
      {saved.length > 0 && (
        <select value={current} onChange={(e) => pick(e.target.value)} className={FIELD} aria-label="Skrip tersimpan">
          <option value="">Skrip tersimpan ({saved.length})</option>
          {saved.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={9}
        spellCheck={false}
        disabled={running}
        placeholder="klik btn_login"
        className={`${FIELD} resize-y font-mono leading-snug`}
      />
      <div className="flex gap-1.5">
        {running ? (
          <Button size="sm" variant="danger" className="flex-1" onClick={() => (cancel.current = true)}>
            <Square size={12} className="mr-1" /> Hentikan
          </Button>
        ) : (
          <Button size="sm" variant="primary" className="flex-1" disabled={!live || recording} onClick={() => void run()}>
            <Play size={12} className="mr-1" /> Jalankan
          </Button>
        )}
        <Button
          size="sm"
          variant={recording ? "danger" : "default"}
          className="flex-1"
          disabled={!live || running}
          title="Rekam: klik dan ketikan di layar HP dicatat jadi baris skrip"
          onClick={onToggleRecord}
        >
          {recording ? <Square size={12} className="mr-1" /> : <Circle size={12} className="mr-1 text-rose-500" />}
          {recording ? "Selesai" : "Rekam"}
        </Button>
      </div>
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama skrip"
          maxLength={40}
          disabled={running}
          className={FIELD}
        />
        <Button size="sm" disabled={running || !name.trim() || !script.trim()} onClick={save}>
          Simpan
        </Button>
        {current && (
          <Button size="sm" disabled={running} onClick={() => void remove()}>
            Hapus
          </Button>
        )}
      </div>

      {(results.length > 0 || summary) && (
        <div className="selectable flex flex-col gap-0.5 text-[10px] leading-snug">
          {results.map((r, i) => (
            <div
              key={i}
              style={{ paddingLeft: r.depth * 10 }}
              className={`flex items-start gap-1 ${r.ok ? "text-[var(--color-ink-soft)]" : "text-rose-500"}`}
            >
              {r.ok ? <Check size={11} className="mt-px shrink-0 text-emerald-500" /> : <X size={11} className="mt-px shrink-0" />}
              <span className="min-w-0 break-words">
                {r.line > 0 && <span className="text-[var(--color-ink-faint)]">{r.line}.</span>} {r.text}
              </span>
            </div>
          ))}
          {!running && results.length > 0 && summary && !summary.startsWith("Skrip") && (
            <button
              onClick={() => void exportReport()}
              title="Simpan hasil tes ini sebagai file teks"
              className="no-drag mt-1 inline-flex items-center gap-1 self-start rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
            >
              <FileDown size={11} /> Simpan hasil
            </button>
          )}
          {summary && (
            <div
              className={`mt-1 font-semibold ${summary.startsWith("LULUS") ? "text-emerald-600" : summary.startsWith("GAGAL") ? "text-rose-500" : "text-amber-600"}`}
            >
              {summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
