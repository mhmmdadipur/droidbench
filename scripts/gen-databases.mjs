#!/usr/bin/env node
// Builds Droidbench debloat databases.
//   node gen-databases.mjs <outDir> <audBaseUrl> <brand...>
// Produces: universal.json (all AUD brands), xiaomi.json (MiDebloat),
//           tv.json (tv-detox).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , outDir, audBase, ...brands] = process.argv;

const RISK_SAFE = new Set(["safe", "recommended", "keep"]);

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

// ---- Parse AUD "package|label|risk" format into category entries ----
function parseAud(text, brandName) {
  const entries = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pkg, label = "", risk = "safe"] = line.split("|").map((s) => s.trim());
    if (!pkg) continue;
    entries.push({
      package: pkg,
      label,
      description: risk,
      safe: RISK_SAFE.has(risk.toLowerCase()),
    });
  }
  return { name: brandName, entries };
}

async function buildUniversal() {
  const categories = [];
  for (const brand of brands) {
    try {
      const text = await fetchText(`${audBase}/${brand}.txt`);
      const cat = parseAud(text, brand.charAt(0).toUpperCase() + brand.slice(1));
      if (cat.entries.length) categories.push(cat);
    } catch (e) {
      console.warn(`  ! skip ${brand}: ${e.message}`);
    }
  }
  const db = {
    id: "universal",
    name: "Universal Debloat",
    source: "Android-Universal-Debloat (myruldev) — MIT",
    categories,
  };
  writeFileSync(join(outDir, "universal.json"), JSON.stringify(db, null, 2));
  const total = categories.reduce((a, c) => a + c.entries.length, 0);
  console.log(`  universal.json: ${categories.length} brands, ${total} packages`);
}

// ---- Xiaomi (MiDebloat-Remover) — curated lists with friendly names ----
const XIAOMI = {
  Ads_and_Telemetry: {
    "com.miui.msa.global": "MIUI System Ads (MSA)",
    "com.miui.systemAdSolution": "MSA Core (Iklan Sistem)",
    "com.miui.analytics": "Analytics / Telemetri",
    "com.miui.android.fashiongallery": "Wallpaper Carousel",
    "com.mfashiongallery.emag": "Glance / Fashion Gallery",
    "com.miui.bugreport": "Bug Report",
    "com.miui.yellowpage": "Yellow Page",
    "com.miui.cleanmaster": "Cleaner (iklan)",
    "com.miui.miservice": "Services & Feedback",
    "com.xiaomi.glgm": "Game Center",
    "com.miui.hybrid": "Quick Apps",
    "com.miui.hybrid.accessory": "Quick Apps Accessory",
    "com.miui.newhome": "App Vault / News Feed",
    "com.facebook.system": "Facebook App Installer",
    "com.facebook.appmanager": "Facebook App Manager",
    "com.facebook.services": "Facebook Services",
    "com.facebook.katana": "Facebook (bawaan)",
    "com.google.android.apps.tachyon": "Google Meet/Duo",
    "com.xiaomi.payment": "Mi Pay",
    "com.mipay.wallet.id": "Mi Pay Wallet",
    "com.google.android.apps.subscriptions.red": "Google One",
    "com.google.android.videos": "Google TV / Movies",
    "com.google.android.feedback": "Google Feedback",
    "com.miui.miwallpaper.wallpaper": "Wallpaper Service",
  },
  Optional_Apps: {
    "com.xiaomi.mipicks": "GetApps (App Store)",
    "com.miui.browser": "Mi Browser",
    "com.mi.globalbrowser": "Mi Browser (Global)",
    "com.miui.videoplayer": "Mi Video",
    "com.miui.video.global": "Mi Video (Global)",
    "com.miui.player": "Mi Music",
    "com.miui.weather2": "Mi Weather",
    "com.miui.notes": "Mi Notes",
    "com.miui.compass": "Compass",
    "com.miui.fm": "FM Radio (HyperOS)",
    "com.miui.fmradio": "FM Radio (MIUI)",
    "com.xiaomi.midrop": "ShareMe",
    "com.google.android.projection.gearhead": "Android Auto",
    "com.miui.cloudservice": "Mi Cloud (core)",
    "com.miui.cloudservice.sysapp": "Mi Cloud (sysapp)",
    "com.miui.cloudbackup": "Mi Cloud Backup",
    "com.miui.micloudsync": "Mi Cloud Sync",
    "com.miui.mishare.connectivity": "Mi Share",
    "com.xiaomi.scanner": "Mi Scanner",
    "com.miui.screenrecorder": "Screen Recorder",
    "com.xiaomi.vipaccount": "Mi Community / VIP",
    "com.miui.virtualsim": "Virtual SIM",
    "com.android.thememanager": "Theme Store",
  },
  Advanced_Risky: {
    "com.xiaomi.joyose": "Joyose (Game Perf) — risky",
    "com.miui.daemon": "MiuiDaemon (Telemetri) — risky",
    "com.miui.powerkeeper": "PowerKeeper (Baterai) — risky",
  },
};

function buildXiaomi() {
  const categories = Object.entries(XIAOMI).map(([name, pkgs]) => ({
    name: name.replace(/_/g, " "),
    entries: Object.entries(pkgs).map(([pkg, label]) => ({
      package: pkg,
      label,
      description: name.includes("Advanced") ? "advanced" : name.includes("Ads") ? "recommended" : "optional",
      safe: !name.includes("Advanced"),
    })),
  }));
  const db = {
    id: "xiaomi",
    name: "Xiaomi / MIUI / HyperOS",
    source: "MiDebloat-Remover (myruldev) — MIT",
    categories,
  };
  writeFileSync(join(outDir, "xiaomi.json"), JSON.stringify(db, null, 2));
  const total = categories.reduce((a, c) => a + c.entries.length, 0);
  console.log(`  xiaomi.json: ${total} packages`);
}

// ---- Android TV (tv-detox) — SAFE list with friendly names, Claude omitted ----
const TV_SAFE = {
  "com.google.android.tvrecommendations": "Google TV sponsored row",
  "com.google.android.backdrop": "Google TV backdrop ads",
  "com.google.android.videos": "Google TV / Play Movies",
  "com.google.android.youtube.tvmusic": "YouTube Music",
  "com.google.android.play.games": "Play Games",
  "com.google.android.feedback": "Google feedback",
  "com.android.printspooler": "Printing",
  "com.android.htmlviewer": "HTML file viewer",
  "com.android.soundpicker": "Sound picker",
  "com.tcl.waterfall.overseas": "TCL content & ads feed",
  "com.tcl.esticker": "TCL e-sticker",
  "com.tcl.partnercustomizer": "TCL launcher customizer",
  "com.tcl.messagebox": "TCL message box",
  "com.tcl.smartalexa": "TCL Alexa",
  "com.tcl.copydatatotv": "TCL phone migration",
  "com.tcl.audioplayer": "TCL audio player",
  "com.tcl.imageplayer": "TCL picture player",
  "com.tcl.keyhelp": "TCL key help",
  "com.tcl.usercenter": "TCL user centre",
  "com.tcl.dashboard": "TCL dashboard",
  "com.tcl.ttvs": "TCL analytics & Alexa hooks",
  "com.tcl.micmanager": "TCL mic manager",
  "com.tcl.factory.view": "TCL factory view",
};
const TV_KEEP = {
  "com.google.android.katniss": "Google TV search & voice",
  "com.google.android.tv.assistant": "Google Assistant",
  "com.google.android.apps.mediashell": "Google Cast",
  "com.google.android.tts": "Text to speech",
  "com.google.android.marvin.talkback": "TalkBack screen reader",
  "com.google.android.apps.tv.dreamx": "Google TV screensaver",
  "com.android.dreams.basic": "Basic screensaver",
};

function buildTv() {
  const categories = [
    {
      name: "Safe to disable (ads / junk)",
      entries: Object.entries(TV_SAFE).map(([pkg, label]) => ({
        package: pkg,
        label,
        description: "safe",
        safe: true,
      })),
    },
    {
      name: "Optional (disable only if unused)",
      entries: Object.entries(TV_KEEP).map(([pkg, label]) => ({
        package: pkg,
        label,
        description: "keep",
        safe: false,
      })),
    },
  ];
  const db = {
    id: "tv",
    name: "Android TV Detox",
    source: "tv-detox (Ansub) — MIT (AI parts omitted)",
    categories,
  };
  writeFileSync(join(outDir, "tv.json"), JSON.stringify(db, null, 2));
  const total = categories.reduce((a, c) => a + c.entries.length, 0);
  console.log(`  tv.json: ${total} packages`);
}

await buildUniversal();
buildXiaomi();
buildTv();
console.log("All databases generated.");
