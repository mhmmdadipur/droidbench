// Auto-clicker engine for the Mirror window.
//
// Steps are stored in NORMALIZED coordinates ([0,1]) so they stay correct when
// the canvas is resized. Replay drives the existing scrcpy control path
// (mirrorTouch down/move/up) so no backend changes are needed.

import { mirrorTouch } from "./mirrorApi";

export type StepKind = "tap" | "swipe";

export interface Step {
  id: string;
  kind: StepKind;
  nx: number; // tap point / swipe start (normalized)
  ny: number;
  nx2?: number; // swipe end
  ny2?: number;
  /** delay in ms AFTER performing this step, before the next one */
  delayMs: number;
  /** how many times to repeat this single step before moving on */
  repeat: number;
}

const STORAGE_KEY = "droidbench.autoclicker.macros";

export interface SavedMacro {
  name: string;
  steps: Step[];
}

export function loadMacros(): SavedMacro[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedMacro[]) : [];
  } catch {
    return [];
  }
}

export function saveMacros(list: SavedMacro[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Perform a single tap at a normalized point. */
async function doTap(nx: number, ny: number) {
  await mirrorTouch("down", nx, ny);
  await sleep(40);
  await mirrorTouch("up", nx, ny);
}

/** Perform a swipe from (nx,ny) to (nx2,ny2) with a few interpolated moves. */
async function doSwipe(nx: number, ny: number, nx2: number, ny2: number) {
  await mirrorTouch("down", nx, ny);
  const SEGMENTS = 12;
  for (let i = 1; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    await mirrorTouch("move", nx + (nx2 - nx) * t, ny + (ny2 - ny) * t);
    await sleep(12);
  }
  await mirrorTouch("up", nx2, ny2);
}

export interface RunHandle {
  stop: () => void;
  /** resolves when the run finishes (or is stopped) */
  done: Promise<void>;
}

/**
 * Run the macro. `loops` = number of full passes (0 or Infinity = until stop).
 * `onStep` reports the currently-executing step index for UI highlighting.
 */
export function runMacro(
  steps: Step[],
  loops: number,
  onStep: (index: number | null) => void,
): RunHandle {
  let stopped = false;
  const done = (async () => {
    const total = loops && loops > 0 ? loops : Infinity;
    for (let loop = 0; loop < total && !stopped; loop++) {
      for (let i = 0; i < steps.length && !stopped; i++) {
        const s = steps[i];
        onStep(i);
        const reps = Math.max(1, s.repeat || 1);
        for (let r = 0; r < reps && !stopped; r++) {
          try {
            if (s.kind === "tap") await doTap(s.nx, s.ny);
            else await doSwipe(s.nx, s.ny, s.nx2 ?? s.nx, s.ny2 ?? s.ny);
          } catch {
            /* control channel hiccup — keep going */
          }
          if (r < reps - 1) await sleep(Math.max(0, s.delayMs));
        }
        await sleep(Math.max(0, s.delayMs));
      }
    }
    onStep(null);
  })();
  return {
    stop: () => {
      stopped = true;
    },
    done,
  };
}
