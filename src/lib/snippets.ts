// Saved text snippets for the mirror window: a label plus text that is typed into the
// phone's focused field with one click. Stored in localStorage on this computer, in
// plain text (no encryption) — so they are not a place for real passwords.

export interface Snippet {
  id: string;
  label: string;
  text: string;
  /** press Enter after the text (to submit a field / search box) */
  enter: boolean;
}

const KEY = "droidbench.mirror.snippets";

function isSnippet(x: unknown): x is Snippet {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.label === "string" &&
    typeof s.text === "string" &&
    typeof s.enter === "boolean"
  );
}

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isSnippet) : [];
  } catch {
    return []; // corrupted or unavailable storage: start empty rather than crash the window
  }
}

export function saveSnippets(list: Snippet[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable: the list still works for this session */
  }
}

export function newSnippetId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
