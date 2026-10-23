// WASM software H.264 decoder fallback (tinyh264) for WebViews without
// WebCodecs (e.g. older/limited WKWebView). Runs tinyh264 inside a Web Worker
// (its intended design) and renders the resulting I420 frames via WebGL.

import type { Decoder } from "./decoder";

/** Split an Annex-B byte stream into NAL units (each incl. its start code). */
function splitNals(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  const starts: number[] = [];
  let i = 0;
  const n = data.length;
  while (i + 3 < n) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i);
      i += 3;
    } else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      starts.push(i);
      i += 4;
    } else {
      i++;
    }
  }
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : n;
    nals.push(data.slice(start, end));
  }
  return nals;
}

export class WasmDecoder implements Decoder {
  private worker: Worker | null = null;
  private renderer: YuvRenderer | null = null;
  private ready = false;
  private failed = false;
  private reported = false;
  private loggedFirst = false;
  private queue: Uint8Array[] = [];
  private readonly renderStateId = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private onError: (msg: string) => void,
    private onSize?: (w: number, h: number) => void,
    private onLog?: (msg: string) => void,
  ) {
    this.init();
  }

  private init() {
    try {
      // Vite bundles this as a module worker.
      this.worker = new Worker(
        new URL("./tinyh264.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "decoderReady") {
          this.ready = true;
          this.onLog?.("WASM decoder ready");
          const q = this.queue;
          this.queue = [];
          for (const nal of q) this.post(nal);
        } else if (msg.type === "pictureReady") {
          if (!this.renderer) this.renderer = new YuvRenderer(this.canvas);
          const pic = new Uint8Array(msg.data);
          if (!this.reported) {
            this.reported = true;
            this.onSize?.(msg.width, msg.height);
            this.onLog?.(`first frame ${msg.width}x${msg.height}`);
          }
          this.renderer.draw(pic, msg.width, msg.height);
        }
      };
      this.worker.onerror = (e) => {
        this.failed = true;
        this.onError(`WASM decoder worker error: ${e.message}`);
      };
      // Tell the worker body to initialize its Emscripten module.
      // TinyH264Worker's init() runs on load (es module default export side-effect
      // is not auto-run), so we post a no-op to ensure it's alive; the worker
      // self-registers its message handler during init().
    } catch (e) {
      this.failed = true;
      this.onError(`WASM decoder failed to load: ${String(e)}`);
      this.onLog?.(`WASM load error: ${String(e)}`);
    }
  }

  private post(nal: Uint8Array) {
    if (!this.worker) return;
    const copy = nal.slice(); // transferable
    this.worker.postMessage(
      {
        type: "decode",
        renderStateId: this.renderStateId,
        data: copy.buffer,
        offset: 0,
        length: copy.byteLength,
      },
      [copy.buffer],
    );
  }

  decode(data: Uint8Array, _config: boolean, _key: boolean, _pts: number) {
    if (this.failed) return;
    const nals = splitNals(data);
    if (!this.loggedFirst) {
      this.loggedFirst = true;
      const types = nals.map((n) => {
        const sc = n[2] === 1 ? 3 : 4;
        return n[sc] & 0x1f;
      });
      this.onLog?.(`WASM got ${nals.length} NAL(s) types=[${types.join(",")}]`);
    }
    for (const nal of nals) {
      if (this.ready) this.post(nal);
      else this.queue.push(nal);
    }
  }

  close() {
    try {
      this.worker?.postMessage({ type: "release", renderStateId: this.renderStateId });
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.renderer?.dispose();
  }
}

/** Minimal WebGL renderer for I420 (YUV 4:2:0) frames. */
class YuvRenderer {
  private gl: WebGLRenderingContext;
  private tex: WebGLTexture[] = [];
  private w = 0;
  private h = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL not available");
    this.gl = gl;
    this.setup();
  }

  private setup() {
    const gl = this.gl;
    const vs = `
      attribute vec2 p; varying vec2 uv;
      void main(){ uv = vec2((p.x+1.0)/2.0, (1.0-p.y)/2.0); gl_Position = vec4(p,0.0,1.0); }`;
    const fs = `
      precision mediump float; varying vec2 uv;
      uniform sampler2D ty, tu, tv;
      void main(){
        float y = texture2D(ty, uv).r;
        float u = texture2D(tu, uv).r - 0.5;
        float v = texture2D(tv, uv).r - 0.5;
        gl_FragColor = vec4(y+1.402*v, y-0.344*u-0.714*v, y+1.772*u, 1.0);
      }`;
    const prog = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < 3; i++) {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tex.push(t);
    }
    gl.uniform1i(gl.getUniformLocation(prog, "ty"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "tu"), 1);
    gl.uniform1i(gl.getUniformLocation(prog, "tv"), 2);
  }

  draw(i420: Uint8Array, w: number, h: number) {
    const gl = this.gl;
    if (w !== this.w || h !== this.h) {
      gl.canvas.width = w;
      gl.canvas.height = h;
      gl.viewport(0, 0, w, h);
      this.w = w;
      this.h = h;
    }
    const ySize = w * h;
    const cSize = (w >> 1) * (h >> 1);
    const planes = [
      { d: i420.subarray(0, ySize), w, h },
      { d: i420.subarray(ySize, ySize + cSize), w: w >> 1, h: h >> 1 },
      { d: i420.subarray(ySize + cSize, ySize + 2 * cSize), w: w >> 1, h: h >> 1 },
    ];
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, planes[i].w, planes[i].h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, planes[i].d);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.tex.forEach((t) => this.gl.deleteTexture(t));
  }
}
