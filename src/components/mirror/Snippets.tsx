import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Plus, Pencil, Trash2, CornerDownLeft, TextCursorInput } from "lucide-react";
import { Button } from "../ui/Button";
import { loadSnippets, saveSnippets, newSnippetId, type Snippet } from "../../lib/snippets";

const FIELD =
  "selectable w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]";

// a search box appears once the list is longer than this
const SEARCH_FROM = 8;

const ROW_BTN =
  "no-drag flex h-[38px] min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 text-sm font-medium transition-colors";

/**
 * The list of saved texts in the mirror panel. Clicking one asks the parent to type it into
 * the phone's focused field (`onSend`); the add / edit form lives here. `onFocusPhone` gives
 * keyboard focus back to the phone after the form is closed, so typing keeps going there.
 */
export function SnippetsPanel({
  onSend,
  onFocusPhone,
}: {
  onSend: (s: Snippet) => void;
  onFocusPhone: () => void;
}) {
  const [list, setList] = useState<Snippet[]>(loadSnippets);
  const [editing, setEditing] = useState<string | null>(null); // a snippet id, "new", or null
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [enter, setEnter] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((x) => x.label.toLowerCase().includes(q) || x.text.toLowerCase().includes(q)) : list;

  function commit(next: Snippet[]) {
    setList(next);
    saveSnippets(next);
  }
  function startNew() {
    setEditing("new");
    setLabel("");
    setText("");
    setEnter(false);
  }
  function startEdit(s: Snippet) {
    setEditing(s.id);
    setLabel(s.label);
    setText(s.text);
    setEnter(s.enter);
  }
  function cancel() {
    setEditing(null);
    onFocusPhone();
  }
  function save() {
    if (!text.trim()) return;
    const name = label.trim() || text.trim().slice(0, 24);
    if (editing === "new") {
      commit([...list, { id: newSnippetId(), label: name, text, enter }]);
    } else {
      commit(list.map((s) => (s.id === editing ? { ...s, label: name, text, enter } : s)));
    }
    setEditing(null);
    onFocusPhone();
  }
  async function remove(s: Snippet) {
    const yes = await ask(`Hapus teks tersimpan "${s.label}"?`, { title: "Hapus teks", kind: "warning" }).catch(
      () => false,
    );
    if (yes) commit(list.filter((x) => x.id !== s.id));
  }

  return (
    <>
      {editing !== null ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nama, mis. Email tes"
            maxLength={40}
            className={FIELD}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Teks yang akan diketik di HP"
            rows={3}
            className={`${FIELD} resize-none`}
          />
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={enter}
              onChange={(e) => setEnter(e.target.checked)}
              className="accent-[var(--color-brand)]"
            />
            Tekan Enter setelahnya
          </label>
          <p className="text-[10px] leading-snug text-[var(--color-ink-faint)]">
            Disimpan di komputer ini tanpa enkripsi. Jangan simpan kata sandi penting.
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" className="flex-1" disabled={!text.trim()} onClick={save}>
              Simpan
            </Button>
            <Button size="sm" className="flex-1" onClick={cancel}>
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={startNew}
          className={`${ROW_BTN} w-full flex-none border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-ink-soft)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-600)]`}
        >
          <Plus size={15} className="shrink-0" />
          <span className="min-w-0 truncate">Tambah teks</span>
        </button>
      )}

      {list.length === 0 && editing === null && (
        <p className="px-1 text-[10px] leading-snug text-[var(--color-ink-faint)]">Belum ada teks tersimpan.</p>
      )}

      {list.length > SEARCH_FROM && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Cari di ${list.length} teks…`}
          aria-label="Cari teks tersimpan"
          className={FIELD}
        />
      )}
      {query.trim() && (
        <p className="px-1 text-[10px] text-[var(--color-ink-faint)]">
          {shown.length} dari {list.length} teks
        </p>
      )}

      <div className="flex max-h-[300px] flex-col gap-1.5 overflow-y-auto pr-0.5">
        {shown.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            <button
              onClick={() => onSend(s)}
              title={s.text}
              className={`${ROW_BTN} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)]`}
            >
              <TextCursorInput size={15} className="shrink-0 text-[var(--color-brand-600)]" />
              <span className="min-w-0 truncate">{s.label}</span>
              {s.enter && (
                <CornerDownLeft size={12} className="ml-auto shrink-0 text-[var(--color-ink-faint)]" aria-label="lalu Enter" />
              )}
            </button>
            <button
              onClick={() => startEdit(s)}
              title="Ubah"
              aria-label={`Ubah ${s.label}`}
              className="no-drag flex h-[38px] w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-brand-600)]"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => void remove(s)}
              title="Hapus"
              aria-label={`Hapus ${s.label}`}
              className="no-drag flex h-[38px] w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-faint)] hover:bg-rose-50 hover:text-rose-500"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
