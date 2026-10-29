// Helpers for the merged "Apps" tab: deriving a human-friendly name from a
// package id, and indexing the debloat databases by package → risk level.

import type { DebloatDatabase } from "./api";

/** Risk level taken from the debloat DB `description` field. */
export type RiskLevel = "recommended" | "safe" | "advanced";

export interface DebloatHit {
  risk: RiskLevel;
  label: string; // curated label from the DB, if any
}

/** Common leading segments / TLD-ish tokens to skip when naming. */
const SKIP = new Set([
  "com", "org", "net", "io", "app", "android", "co", "id", "go",
  "me", "tv", "dev", "www", "mobi", "gg", "xyz",
]);

/**
 * Turn a package name into a readable app name.
 *  com.spotify.music       → "Spotify Music"
 *  org.telegram.messenger  → "Telegram Messenger"
 *  com.discord             → "Discord"
 * Falls back to the raw package when nothing sensible can be derived.
 */
export function deriveAppName(pkg: string): string {
  const parts = pkg.split(".").filter(Boolean);
  if (parts.length === 0) return pkg;

  // drop leading generic segments (com/org/io/android/country codes…)
  let i = 0;
  while (i < parts.length - 1 && SKIP.has(parts[i].toLowerCase())) i++;
  let meaningful = parts.slice(i);

  // drop trailing generic/structural segments but keep at least one
  const TRAIL = new Set(["android", "app", "apps", "mobile", "release", "prod", "client"]);
  while (meaningful.length > 1 && TRAIL.has(meaningful[meaningful.length - 1].toLowerCase())) {
    meaningful = meaningful.slice(0, -1);
  }

  // obfuscated/garbage names (e.g. vctsrt.cntgtj.uqfwgg) — no vowels, random
  const looksRandom = meaningful.every((s) => s.length <= 7 && !/[aeiou]/i.test(s));
  if (looksRandom) return pkg;

  // take the last 1–2 meaningful tokens, title-case them
  const take = meaningful.slice(-2).filter((s) => !SKIP.has(s.toLowerCase()));
  const tokens = take.length ? take : meaningful.slice(-1);
  return tokens
    .map((s) => s.replace(/[_-]+/g, " "))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ")
    .trim();
}

/** Normalize the DB `description` into a RiskLevel. */
function toRisk(desc: string | undefined): RiskLevel {
  const d = (desc || "").toLowerCase();
  if (d.includes("advanced") || d.includes("unsafe") || d.includes("expert") || d.includes("keep"))
    return "advanced";
  if (d.includes("recommended")) return "recommended";
  // "safe", "optional", unknown → safe
  return "safe";
}

/**
 * Build a package → debloat-hit index from one or more loaded databases.
 * When a package appears in several DBs, the riskier classification wins so we
 * never understate the risk.
 */
export function buildDebloatIndex(dbs: DebloatDatabase[]): Map<string, DebloatHit> {
  const rank: Record<RiskLevel, number> = { recommended: 0, safe: 1, advanced: 2 };
  const idx = new Map<string, DebloatHit>();
  for (const db of dbs) {
    for (const cat of db.categories) {
      for (const e of cat.entries) {
        const risk = e.safe === false ? "advanced" : toRisk(e.description);
        const prev = idx.get(e.package);
        if (!prev || rank[risk] > rank[prev.risk]) {
          idx.set(e.package, { risk, label: e.label || "" });
        }
      }
    }
  }
  return idx;
}
