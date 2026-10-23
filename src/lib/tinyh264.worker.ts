// Dedicated Web Worker entry for the tinyh264 software decoder.
// TinyH264Worker exports init() but does not auto-run it; we call it here so the
// worker registers its message handlers and signals `decoderReady`.
import { init } from "tinyh264/es/TinyH264Worker.js";

init();
