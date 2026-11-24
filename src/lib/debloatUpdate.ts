// Refreshes the "universal" debloat list from its upstream project (Android-Universal-Debloat,
// MIT). Same sources and format as scripts/gen-databases.mjs; the result is handed to Rust
// (save_debloat_db), which keeps it next to the app data and prefers it over the bundled copy.

import type { DebloatCategory, DebloatDatabase } from "./api";

const AUD_BASE = "https://raw.githubusercontent.com/myruldev/Android-Universal-Debloat/main/database";
const AUD_BRANDS = [
  "universal", "samsung", "xiaomi", "oppo", "vivo", "realme", "oneplus", "motorola", "nokia", "sony",
  "asus", "honor", "huawei", "infinix", "itel", "lenovo", "lg", "meizu", "nubia", "pixel", "sharp",
  "tcl", "tecno", "wiko", "zte",
];
const RISK_SAFE = new Set(["safe", "recommended", "keep"]);

/** Parse the "package|label|risk" lines of one brand file. */
export function parseAud(text: string, name: string): DebloatCategory {
  const entries: DebloatCategory["entries"] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pkg, label = "", risk = "safe"] = line.split("|").map((s) => s.trim());
    if (!pkg || !/^[\w.]+$/.test(pkg)) continue; // not a package name: skip junk lines
    entries.push({ package: pkg, label, description: risk, safe: RISK_SAFE.has(risk.toLowerCase()) });
  }
  return { name, entries };
}

/** Download every brand file and build the universal database. Brands that fail are skipped. */
export async function fetchUniversalDb(): Promise<{ db: DebloatDatabase; failed: string[] }> {
  const results = await Promise.allSettled(
    AUD_BRANDS.map(async (brand) => {
      const res = await fetch(`${AUD_BASE}/${brand}.txt`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${brand}: HTTP ${res.status}`);
      return parseAud(await res.text(), brand.charAt(0).toUpperCase() + brand.slice(1));
    }),
  );
  const categories: DebloatCategory[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.entries.length > 0) categories.push(r.value);
    else failed.push(AUD_BRANDS[i]);
  });
  if (categories.length === 0) throw new Error("no list could be downloaded (offline?)");
  return {
    db: {
      id: "universal",
      name: "Universal Debloat",
      source: "Android-Universal-Debloat (myruldev) — MIT",
      categories,
    },
    failed,
  };
}
