// Parses the XML printed by `uiautomator dump` and answers "which element is under
// this point?". Pure functions only (no DOM, no Tauri) so they can be tested in plain Node.
//
// What the dump contains: one <node> per accessibility node, with `resource-id`,
// `content-desc`, `text`, `class`, `bounds` and a set of true/false flags. For Flutter apps
// the interesting part is: Semantics(identifier: 'x') is exposed as resource-id and a
// Semantics label usually as content-desc / text. Plain widgets and Keys are NOT exposed.

export interface UiNode {
  /** index in document order (also the index into UiTree.nodes) */
  id: number;
  /** id of the parent node, -1 for top-level nodes */
  parent: number;
  depth: number;
  className: string;
  pkg: string;
  resourceId: string;
  contentDesc: string;
  text: string;
  hint: string;
  l: number;
  t: number;
  r: number;
  b: number;
  clickable: boolean;
  longClickable: boolean;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  checkable: boolean;
  checked: boolean;
  password: boolean;
}

export interface UiTree {
  nodes: UiNode[];
  /** screen size in pixels, from the extent of the top-level nodes */
  width: number;
  height: number;
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, e: string) => {
    switch (e) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return ""; // not a valid code point
    }
  });
}

// An opening tag whose attribute values may contain ">" (the quoted-string alternative
// keeps the match from ending inside one), a self-closing tag, or a closing tag.
const TAG = /<node\b((?:[^>"]|"[^"]*")*?)(\/?)>|<\/node\s*>/g;
const ATTR = /([\w:-]+)="([^"]*)"/g;
const BOUNDS = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

export function parseUiDump(xml: string): UiTree {
  const nodes: UiNode[] = [];
  const stack: number[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(xml)) !== null) {
    if (m[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    const a: Record<string, string> = {};
    for (const x of m[1].matchAll(ATTR)) a[x[1]] = decode(x[2]);
    const b = BOUNDS.exec(a["bounds"] ?? "");
    const flag = (k: string) => a[k] === "true";
    const id = nodes.length;
    nodes.push({
      id,
      parent: stack.length > 0 ? stack[stack.length - 1] : -1,
      depth: stack.length,
      className: a["class"] ?? "",
      pkg: a["package"] ?? "",
      resourceId: a["resource-id"] ?? "",
      contentDesc: a["content-desc"] ?? "",
      text: a["text"] ?? "",
      hint: a["hint"] ?? "",
      l: b ? Number(b[1]) : 0,
      t: b ? Number(b[2]) : 0,
      r: b ? Number(b[3]) : 0,
      b: b ? Number(b[4]) : 0,
      clickable: flag("clickable"),
      longClickable: flag("long-clickable"),
      enabled: a["enabled"] !== "false",
      focusable: flag("focusable"),
      scrollable: flag("scrollable"),
      checkable: flag("checkable"),
      checked: flag("checked"),
      password: flag("password"),
    });
    if (m[2] !== "/") stack.push(id); // self-closing tags have no closing tag to pop
  }

  let width = 0;
  let height = 0;
  for (const n of nodes) {
    if (n.depth === 0) {
      width = Math.max(width, n.r);
      height = Math.max(height, n.b);
    }
  }
  if (!width || !height) {
    for (const n of nodes) {
      width = Math.max(width, n.r);
      height = Math.max(height, n.b);
    }
  }
  return { nodes, width, height };
}

/**
 * The element under a point given as fractions of the screen (0..1). Nodes are in drawing
 * order, so the LAST node that contains the point is the one on top (and, because children
 * follow their parent, the deepest one).
 */
export function hitTest(tree: UiTree, nx: number, ny: number): UiNode | null {
  if (!tree.width || !tree.height) return null;
  const x = nx * tree.width;
  const y = ny * tree.height;
  let best: UiNode | null = null;
  for (const n of tree.nodes) {
    if (n.r <= n.l || n.b <= n.t) continue; // zero-size: nothing to point at
    if (x >= n.l && x < n.r && y >= n.t && y < n.b) best = n;
  }
  return best;
}

export const isInteractive = (n: UiNode): boolean => n.enabled && (n.clickable || n.longClickable || n.checkable);

export type IdLevel = "id" | "label" | "none";

export interface Analysis {
  /** nodes the user can tap */
  interactive: UiNode[];
  /** per node (indexed by UiNode.id): "id" = has resource-id, "label" = has content-desc/text
   *  (its own, or somewhere below it), "none" = nothing a test could find it by */
  level: IdLevel[];
  counts: { total: number; interactive: number; withId: number; labelOnly: number; none: number };
}

export function analyze(tree: UiTree): Analysis {
  const nodes = tree.nodes;
  const own: IdLevel[] = nodes.map((n) => (n.resourceId ? "id" : n.contentDesc || n.text ? "label" : "none"));

  // A tappable container (a card, a button wrapper) often has no id itself but wraps a
  // labelled child: tests can still reach it through that child, so it is not "anonymous".
  // Descendants come right after their parent, so a backwards pass can push "has an
  // identity somewhere in my subtree" up to the parents.
  const subtree: boolean[] = new Array(nodes.length).fill(false);
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (own[i] !== "none") subtree[i] = true;
    const p = nodes[i].parent;
    if (p >= 0 && subtree[i]) subtree[p] = true;
  }
  const level: IdLevel[] = own.map((o, i) => (o === "none" && subtree[i] ? "label" : o));

  const interactive = nodes.filter(isInteractive);
  const counts = { total: nodes.length, interactive: interactive.length, withId: 0, labelOnly: 0, none: 0 };
  for (const n of interactive) {
    const lv = level[n.id];
    if (lv === "id") counts.withId++;
    else if (lv === "label") counts.labelOnly++;
    else counts.none++;
  }
  return { interactive, level, counts };
}

export const shortClass = (c: string): string => c.split(".").pop() || c || "node";

/** "Parent > ... > Node" using short class names, at most `max` levels up. */
export function pathOf(tree: UiTree, n: UiNode, max = 6): string {
  const parts: string[] = [];
  let cur: UiNode | undefined = n;
  while (cur && parts.length < max) {
    parts.unshift(shortClass(cur.className));
    cur = cur.parent >= 0 ? tree.nodes[cur.parent] : undefined;
  }
  return (cur ? "… > " : "") + parts.join(" > ");
}

// XPath 1.0 has no escape for quotes: use the other quote type, or concat() when both occur.
function xpathLiteral(s: string): string {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return "concat(" + s.split('"').map((p) => `"${p}"`).join(`, '"', `) + ")";
}

/** The most stable selector the node offers, as an XPath (Appium / uiautomator style). */
export function xpathFor(n: UiNode): string {
  if (n.resourceId) return `//*[@resource-id=${xpathLiteral(n.resourceId)}]`;
  if (n.contentDesc) return `//*[@content-desc=${xpathLiteral(n.contentDesc)}]`;
  if (n.text && !n.password) return `//*[@text=${xpathLiteral(n.text)}]`;
  return `//${n.className || "*"}`; // nothing stable: only the class is known
}

/** A multi-line plain-text description, for pasting into a bug report. */
export function describe(tree: UiTree, n: UiNode): string {
  const lines = [
    `class: ${n.className}`,
    `package: ${n.pkg}`,
    `resource-id: ${n.resourceId || "-"}`,
    `content-desc: ${n.contentDesc || "-"}`,
    `text: ${n.password ? "(hidden)" : n.text || "-"}`,
    `bounds: [${n.l},${n.t}][${n.r},${n.b}] (${n.r - n.l}x${n.b - n.t})`,
    `clickable: ${n.clickable}, long-clickable: ${n.longClickable}, enabled: ${n.enabled}, scrollable: ${n.scrollable}`,
    `path: ${pathOf(tree, n)}`,
    `xpath: ${xpathFor(n)}`,
  ];
  return lines.join("\n");
}
