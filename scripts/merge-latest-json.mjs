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
// Apple Silicon. Add "x86_64-apple-darwin" too if you ship Intel builds.
latest.platforms["aarch64-apple-darwin"] = { signature, url };

process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
