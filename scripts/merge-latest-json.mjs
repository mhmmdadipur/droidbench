#!/usr/bin/env node
// Merge the macOS updater entry into the CI-generated latest.json so a single
// latest.json covers mac + windows + linux.
//
// Usage:
//   node scripts/merge-latest-json.mjs <ci-latest.json> <mac-app.tar.gz.sig> <download-url>
//
// - <ci-latest.json>        latest.json downloaded from the release (win+linux)
// - <mac-app.tar.gz.sig>    the signature file from the local mac build
// - <download-url>          public URL of the uploaded macOS .app.tar.gz
//
// Writes the merged latest.json to stdout (redirect to a file and re-upload).
import { readFileSync } from "node:fs";

const [, , ciPath, sigPath, url] = process.argv;
if (!ciPath || !sigPath || !url) {
  console.error("usage: merge-latest-json.mjs <ci-latest.json> <mac.sig> <mac-url>");
  process.exit(1);
}

const latest = JSON.parse(readFileSync(ciPath, "utf8"));
const signature = readFileSync(sigPath, "utf8").trim();

latest.platforms = latest.platforms || {};
// The updater looks up "{os}-{arch}-{bundle_type}" first, then "{os}-{arch}"
// (tauri-plugin-updater, updater.rs). On Apple Silicon that is "darwin-aarch64-app"
// then "darwin-aarch64" — NOT the Rust target triple. An entry keyed
// "aarch64-apple-darwin" never matches, so macOS would never see an update.
// Write both keys, exactly like tauri-action does for the other platforms.
// Add "darwin-x86_64" / "darwin-x86_64-app" too if you ship Intel builds.
latest.platforms["darwin-aarch64"] = { signature, url };
latest.platforms["darwin-aarch64-app"] = { signature, url };
// drop the wrong key written by earlier versions of this script, if present
delete latest.platforms["aarch64-apple-darwin"];

process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
