import { Copy, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  describe,
  isInteractive,
  pathOf,
  xpathFor,
  type Analysis,
  type IdLevel,
  type UiNode,
  type UiTree,
} from "../../lib/uiInspector";

/** colour of an element's outline: has a resource-id / has a label or text / nothing to find it by */
const COLOR: Record<IdLevel, string> = { id: "#10b981", label: "#38bdf8", none: "#f43f5e" };

/**
 * Outlines drawn over the mirrored screen: every tappable element coloured by how findable it
 * is, plus the hovered (blue) and selected (amber) element. Same box as the auto-clicker's
 * StepOverlay (matches the canvas' aspect), with the SVG in device pixels so the node bounds
 * can be used as they are.
 */
export function InspectorOverlay({
  tree,
  analysis,
  aspect,
  hoverId,
  selId,
}: {
  tree: UiTree;
  analysis: Analysis;
  aspect: number;
  hoverId: number | null;
  selId: number | null;
}) {
  const sel = selId != null ? tree.nodes[selId] : undefined;
  const hov = hoverId != null && hoverId !== selId ? tree.nodes[hoverId] : undefined;
  const box = (n: UiNode) => ({ x: n.l, y: n.t, width: Math.max(0, n.r - n.l), height: Math.max(0, n.b - n.t) });
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative max-h-full max-w-full" style={{ aspectRatio: String(aspect), height: "100%" }}>
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${tree.width} ${tree.height}`}
          preserveAspectRatio="none"
        >
          {analysis.interactive.map((n) => (
            <rect
              key={n.id}
              {...box(n)}
              fill="none"
              stroke={COLOR[analysis.level[n.id]]}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              opacity={0.85}
            />
          ))}
          {hov && (
            <rect
              {...box(hov)}
              fill="rgba(59,130,246,0.18)"
              stroke="#3b82f6"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {sel && (
            <rect
              {...box(sel)}
              fill="rgba(245,158,11,0.22)"
              stroke="#f59e0b"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Field({ label, value, onCopy }: { label: string; value: string; onCopy: (text: string) => void }) {
  return (
    <div className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</div>
        <div
          className={cn(
            "selectable break-all text-[11px] leading-snug",
            value ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]",
          )}
        >
          {value || "—"}
        </div>
      </div>
      {value && (
        <button
          onClick={() => onCopy(value)}
          title={`Salin ${label}`}
          aria-label={`Salin ${label}`}
          className="no-drag mt-2 shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-brand-600)]"
        >
          <Copy size={12} />
        </button>
      )}
    </div>
  );
}

/** The inspector's controls and the details of the selected element (in the right-hand panel). */
export function InspectorPanel({
  tree,
  analysis,
  node,
  busy,
  stale,
  onRefresh,
  onCopy,
  onInsert,
}: {
  tree: UiTree | null;
  analysis: Analysis | null;
  node: UiNode | null;
  busy: boolean;
  stale: boolean;
  onRefresh: () => void;
  onCopy: (text: string) => void;
  /** add a line for this element to the Tes UI script */
  onInsert: (kind: "klik" | "isi" | "tunggu" | "ada") => void;
}) {
  const anonymous = node != null && analysis != null && isInteractive(node) && analysis.level[node.id] === "none";
  const flags = node
    ? [
        node.clickable && "clickable",
        node.longClickable && "long-clickable",
        node.scrollable && "scrollable",
        node.checkable && (node.checked ? "checked" : "checkable"),
        node.focusable && "focusable",
        node.password && "password",
        !node.enabled && "disabled",
      ].filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={onRefresh}
        disabled={busy}
        className="no-drag flex h-[34px] items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand)] disabled:opacity-50"
      >
        <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        {busy ? "Membaca layar HP…" : "Segarkan"}
      </button>

      {stale && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[10.5px] leading-snug text-amber-700">
          Layar berubah. Tekan Segarkan untuk memuat ulang elemennya.
        </p>
      )}

      {tree && analysis && (
        <div className="rounded-lg bg-[var(--color-bg)] px-2.5 py-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
          <div>
            {analysis.counts.total} elemen, {analysis.counts.interactive} bisa diklik
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <Legend color={COLOR.id} label={`ID ${analysis.counts.withId}`} />
            <Legend color={COLOR.label} label={`Label ${analysis.counts.labelOnly}`} />
            <Legend color={COLOR.none} label={`Tanpa ID ${analysis.counts.none}`} />
          </div>
        </div>
      )}

      {tree && !node && (
        <p className="px-1 text-[10.5px] leading-snug text-[var(--color-ink-faint)]">
          Klik elemen di layar HP untuk melihat detailnya. Klik tidak menyentuh HP selama Inspector aktif.
        </p>
      )}

      {tree && node && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <Field label="resource-id" value={node.resourceId} onCopy={onCopy} />
          <Field label="content-desc" value={node.contentDesc} onCopy={onCopy} />
          <Field label="text" value={node.password ? "" : node.text} onCopy={onCopy} />
          <Field label="class" value={node.className} onCopy={onCopy} />
          <Field label="package" value={node.pkg} onCopy={onCopy} />
          <Field
            label="bounds"
            value={`[${node.l},${node.t}][${node.r},${node.b}]  ${node.r - node.l}x${node.b - node.t} px`}
            onCopy={onCopy}
          />
          <Field label="path" value={pathOf(tree, node)} onCopy={onCopy} />
          {flags.length > 0 && (
            <div className="text-[10px] leading-snug text-[var(--color-ink-faint)]">{flags.join(" · ")}</div>
          )}

          {anonymous && (
            <p className="rounded-md bg-rose-50 px-2 py-1.5 text-[10.5px] leading-snug text-rose-700">
              Elemen ini bisa diklik tapi tidak punya ID atau label yang bisa dipakai tes. Di Flutter, bungkus widget-nya dengan
              Semantics(identifier: &apos;nama_unik&apos;), yang jadi resource-id di Android, atau beri Semantics label.
            </p>
          )}

          <div className="flex gap-1.5">
            <button
              onClick={() => onCopy(xpathFor(node))}
              className="no-drag flex-1 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-[11px] font-medium text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
            >
              Salin XPath
            </button>
            <button
              onClick={() => onCopy(describe(tree, node))}
              className="no-drag flex-1 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-[11px] font-medium text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
            >
              Salin detail
            </button>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Tambah ke skrip Tes UI</div>
          <div className="grid grid-cols-4 gap-1">
            {(["klik", "isi", "tunggu", "ada"] as const).map((k) => (
              <button
                key={k}
                onClick={() => onInsert(k)}
                title={`Tambahkan baris "${k}" untuk elemen ini`}
                className="no-drag rounded-md border border-[var(--color-border)] px-1 py-1.5 text-[11px] font-medium text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]"
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
