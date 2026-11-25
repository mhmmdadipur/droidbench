// A tiny line-based script for UI checks against the phone's accessibility tree, e.g.
//
//   # login
//   tunggu login_email
//   isi login_email = user@test.com
//   isi login_password = rahasia
//   klik btn_login
//   tunggu home_title
//   cek home_title = Selamat datang
//
// Pure functions only (no DOM, no Tauri) so they can be tested in plain Node.

import type { UiNode, UiTree } from "./uiInspector";

export type StepKind = "klik" | "isi" | "tunggu" | "ada" | "tidakada" | "cek" | "jeda" | "tekan" | "jika" | "ulangi";

/** Deepest nesting of jika / ulangi blocks, and the most steps one run may execute. */
export const MAX_DEPTH = 4;
export const MAX_EXECUTED = 2000;

/** Keys the `tekan` command knows, as Android keycodes. */
export const PRESS_KEYS: Record<string, number> = { enter: 66, kembali: 4, back: 4, home: 3, tab: 61, hapus: 67 };

export interface TestStep {
  /** 1-based line in the script, for messages */
  line: number;
  kind: StepKind;
  /** resource-id, or a label / text, of the element */
  target: string;
  /** text to type (isi), text to expect (cek) */
  value: string;
  /** pause length (jeda) */
  ms: number;
  /** jika: the condition on `target` */
  cond?: "ada" | "tidakada";
  /** ulangi: how many times to run `body` */
  count?: number;
  /** jika / ulangi: the steps inside the block (jika: the "then" part) */
  body?: TestStep[];
  /** jika: the steps after `lainnya` */
  elseBody?: TestStep[];
}

export interface ParseResult {
  steps: TestStep[];
  errors: { line: number; message: string }[];
}

export const USAGE = [
  "klik <id>",
  "isi <id> = <teks>",
  "tunggu <id>",
  "ada <id>",
  "tidak ada <id>",
  "cek <id> = <teks>",
  "jeda <detik>",
  "tekan <enter|kembali|home|tab|hapus>",
  "jika ada <id> ... lainnya ... selesai",
  "jika tidak ada <id> ... selesai",
  "ulangi <n> ... selesai",
];

export function parseScript(src: string): ParseResult {
  const root: TestStep[] = [];
  const errors: ParseResult["errors"] = [];
  // open jika / ulangi blocks, innermost last; `inElse` once `lainnya` was seen
  const stack: { step: TestStep; inElse: boolean }[] = [];
  const current = (): TestStep[] => {
    const top = stack[stack.length - 1];
    if (!top) return root;
    return top.inElse ? (top.step.elseBody as TestStep[]) : (top.step.body as TestStep[]);
  };
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const m = /^(\S+)\s*(.*)$/.exec(t);
    if (!m) return;
    const cmd = m[1].toLowerCase();
    let rest = m[2].trim();
    const fail = (message: string) => errors.push({ line, message });
    const step = (kind: StepKind, target = "", value = "", ms = 0): TestStep => {
      const st: TestStep = { line, kind, target, value, ms };
      current().push(st);
      return st;
    };
    const open = (st: TestStep) => {
      if (stack.length >= MAX_DEPTH) {
        // still track it so the matching 'selesai' does not raise a second error
        fail(`blok terlalu dalam (maksimal ${MAX_DEPTH} tingkat)`);
      }
      stack.push({ step: st, inElse: false });
    };

    if (cmd === "tidak" && /^ada\b/i.test(rest)) {
      rest = rest.replace(/^ada\b\s*/i, "");
      if (!rest) return fail("'tidak ada' butuh id");
      return step("tidakada", rest);
    }
    switch (cmd) {
      case "ulangi": {
        const n = Number(rest);
        if (!Number.isInteger(n) || n < 1 || n > 100) return fail("ulangi butuh bilangan bulat 1 sampai 100");
        const st = step("ulangi");
        st.count = n;
        st.body = [];
        return open(st);
      }
      case "jika": {
        const neg = /^tidak\s+ada\b/i.exec(rest);
        const pos = /^ada\b/i.exec(rest);
        const target = rest.replace(/^(tidak\s+)?ada\b\s*/i, "");
        if ((!neg && !pos) || !target) return fail("format: jika ada <id>  atau  jika tidak ada <id>");
        const st = step("jika", target);
        st.cond = neg ? "tidakada" : "ada";
        st.body = [];
        st.elseBody = [];
        return open(st);
      }
      case "lainnya": {
        const top = stack[stack.length - 1];
        if (!top || top.step.kind !== "jika" || top.inElse) return fail("'lainnya' hanya boleh di dalam blok 'jika', sekali");
        top.inElse = true;
        return;
      }
      case "selesai": {
        if (stack.length === 0) return fail("'selesai' tanpa blok 'jika' atau 'ulangi'");
        stack.pop();
        return;
      }
      case "klik":
      case "tunggu":
      case "ada": {
        if (!rest) return fail(`'${cmd}' butuh id`);
        return step(cmd, rest);
      }
      case "isi":
      case "cek": {
        const eq = rest.indexOf(" = ");
        const at = eq >= 0 ? eq : rest.endsWith(" =") ? rest.length - 2 : -1;
        if (at < 0) return fail(`format: ${cmd} <id> = <teks>`);
        const target = rest.slice(0, at).trim();
        const value = eq >= 0 ? rest.slice(eq + 3) : "";
        if (!target) return fail(`'${cmd}' butuh id sebelum " = "`);
        return step(cmd, target, value);
      }
      case "tekan": {
        const k = rest.toLowerCase();
        if (!(k in PRESS_KEYS)) return fail(`tekan: tombol tidak dikenal (${Object.keys(PRESS_KEYS).join(", ")})`);
        return step("tekan", "", k);
      }
      case "jeda": {
        const s = Number(rest.replace(",", "."));
        if (!rest || !Number.isFinite(s) || s < 0 || s > 60) return fail("jeda butuh angka detik 0 sampai 60");
        return step("jeda", "", "", Math.round(s * 1000));
      }
      default:
        return fail(`perintah tidak dikenal: ${cmd}`);
    }
  });
  for (const f of stack) {
    errors.push({ line: f.step.line, message: `blok '${f.step.kind === "jika" ? "jika" : "ulangi"}' belum ditutup dengan 'selesai'` });
  }
  return { steps: root, errors };
}

/** Number of runnable steps, counting the inside of blocks once (for "n steps" labels). */
export function countSteps(steps: TestStep[]): number {
  return steps.reduce((n, s) => n + 1 + countSteps(s.body ?? []) + countSteps(s.elseBody ?? []), 0);
}

export type MatchBy = "id" | "label" | "teks";

/**
 * Find the element a script line refers to. Order: resource-id (exact, or the part after
 * "package:id/"), then content-desc, then text. Invisible (zero-size) nodes never match.
 */
export function findNode(tree: UiTree, target: string): { node: UiNode; by: MatchBy } | null {
  const visible = tree.nodes.filter((n) => n.r > n.l && n.b > n.t);
  const byId = visible.find((n) => n.resourceId && (n.resourceId === target || n.resourceId.endsWith(`/${target}`)));
  if (byId) return { node: byId, by: "id" };
  const byDesc = visible.find((n) => n.contentDesc === target);
  if (byDesc) return { node: byDesc, by: "label" };
  const byText = visible.find((n) => n.text === target);
  if (byText) return { node: byText, by: "teks" };
  return null;
}

/** Centre of a node as fractions of the screen, ready for mirrorTouch. */
export function centerOf(tree: UiTree, n: UiNode): { nx: number; ny: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    nx: clamp((n.l + n.r) / 2 / tree.width),
    ny: clamp((n.t + n.b) / 2 / tree.height),
  };
}

/** What `cek` compares against: the node's text, else its label. */
export function shownText(n: UiNode): string {
  return n.text || n.contentDesc;
}

/** The name a script line should use for this element: resource-id, else label, else text. */
export function targetFor(n: UiNode): string | null {
  if (n.resourceId) {
    // "pkg:id/name" -> "name" (findNode matches the short form too); Flutter identifiers have no prefix
    const i = n.resourceId.lastIndexOf("/");
    return i >= 0 && i < n.resourceId.length - 1 ? n.resourceId.slice(i + 1) : n.resourceId;
  }
  const t = n.contentDesc || (n.password ? "" : n.text);
  return t.trim() ? t.trim() : null;
}

/**
 * The element a TAP at `n` most likely meant. A tap lands on the deepest node (often a text
 * inside a button), but the identifier usually sits on the button. So walk up to the first
 * clickable ancestor and take the first node on the way with an id, else with a label.
 */
export function tapTarget(tree: UiTree, n: UiNode): { target: string; node: UiNode; unique: boolean } | null {
  const chain: UiNode[] = [];
  let cur: UiNode | undefined = n;
  while (cur) {
    chain.push(cur);
    if (cur.clickable || cur.longClickable) break;
    cur = cur.parent >= 0 ? tree.nodes[cur.parent] : undefined;
  }
  // no clickable ancestor: the tap was on a plain element, so don't borrow an id from a big container
  const own = chain[chain.length - 1];
  if (!(own.clickable || own.longClickable)) chain.splice(1);
  const pick = chain.find((c) => c.resourceId) ?? chain.find((c) => targetFor(c));
  if (!pick) return null;
  const target = targetFor(pick);
  if (!target) return null;
  // would the script find THIS element again, or another one with the same name?
  const found = findNode(tree, target);
  return { target, node: pick, unique: found?.node.id === pick.id };
}

export const EXAMPLE_SCRIPT = `# Contoh: isi form login lalu cek hasilnya
tunggu login_email
isi login_email = user@test.com
isi login_password = rahasia
klik btn_login
tunggu home_title
`;

/** Add a line at the end of the script. */
export function appendLine(script: string, line: string): string {
  const base = script.replace(/\s+$/, "");
  return `${base ? `${base}\n` : ""}${line}\n`;
}

/**
 * Typed text while recording: it belongs to the field that was just tapped. A trailing
 * `klik X` becomes `isi X = text`; more text into the same field is added to its value.
 * With no field before it the text is kept as a comment so nothing is lost silently.
 */
export function recordText(script: string, text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ");
  if (!flat) return script;
  const lines = script.replace(/\s+$/, "").split("\n");
  const last = lines.length - 1;
  const m = /^\s*(klik|isi)\s+(.*)$/i.exec(lines[last] ?? "");
  if (m) {
    if (m[1].toLowerCase() === "klik") {
      lines[last] = `isi ${m[2].trim()} = ${flat}`;
      return `${lines.join("\n")}\n`;
    }
    const eq = m[2].indexOf(" = ");
    if (eq >= 0 || m[2].endsWith(" =")) {
      lines[last] = `${lines[last].trimEnd()}${eq >= 0 ? "" : " "}${flat}`;
      return `${lines.join("\n")}\n`;
    }
  }
  return appendLine(script, `# diketik tanpa kolom yang diketuk: ${flat}`);
}

/**
 * Variables: `{Name}` in an `isi` / `cek` value is replaced by the Saved Text (Teks Tersimpan)
 * whose name is Name (case-insensitive). Test data then lives in one place instead of in every
 * script. Unknown names are reported, not left in the text.
 */
const VAR = /\{([^{}\n]+)\}/g;

export function resolveVars(text: string, vars: Map<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(VAR, (whole, raw: string) => {
    const v = vars.get(raw.trim().toLowerCase());
    if (v === undefined) {
      missing.push(raw.trim());
      return whole;
    }
    return v;
  });
  return { text: out, missing };
}

/** Saved texts as a lookup table for resolveVars (later duplicates of a name lose). */
export function varTable(list: { label: string; text: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of list) {
    const k = s.label.trim().toLowerCase();
    if (k && !m.has(k)) m.set(k, s.text);
  }
  return m;
}

/** Every unknown variable used anywhere in the steps, as parse-style errors. */
export function varErrors(steps: TestStep[], vars: Map<string, string>): { line: number; message: string }[] {
  const errs: { line: number; message: string }[] = [];
  const walk = (list: TestStep[]) => {
    for (const s of list) {
      if (s.kind === "isi" || s.kind === "cek") {
        for (const name of resolveVars(s.value, vars).missing) {
          errs.push({ line: s.line, message: `variabel {${name}} tidak ada di Teks Tersimpan` });
        }
      }
      walk(s.body ?? []);
      walk(s.elseBody ?? []);
    }
  };
  walk(steps);
  return errs;
}
