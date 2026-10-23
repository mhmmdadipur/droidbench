// H.264 decode pipeline for embedded mirroring.
//
// Primary path: WebCodecs VideoDecoder (hardware accelerated on Windows/WebView2
// and macOS Safari 16.4+). Fallback path: a WASM software decoder (see
// wasmDecoder.ts) for older WebViews that lack WebCodecs.

export interface Decoder {
  /** Feed a packet. `config` marks SPS/PPS; `key` marks a keyframe. */
  decode(data: Uint8Array, config: boolean, key: boolean, pts: number): void;
  close(): void;
}

export function webcodecsAvailable(): boolean {
  return typeof (globalThis as any).VideoDecoder !== "undefined";
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Codec string per scrcpy codec id. */
function codecString(codec: string): string {
  switch (codec) {
    case "h265":
      return "hev1.1.6.L93.B0";
    case "av1":
      return "av01.0.08M.08";
    default:
      return "avc1.42E01E";
  }
}

/** Find the SPS NAL (type 7) in an Annex-B buffer and build the exact
 *  avc1.PPCCLL codec string. The level from the SPS is often too low for the
 *  actual resolution, so we clamp it up to level 5.1 (0x33) which covers any
 *  phone screen and keeps WebCodecs from rejecting the stream. */
function avcCodecFromSps(data: Uint8Array): string | null {
  const off = firstStartCode(data);
  if (off < 0) return null;
  let i = off;
  // walk NALs to find SPS (type 7)
  while (i >= 0 && i + 4 < data.length) {
    const scLen = data[i + 2] === 1 ? 3 : 4;
    const nalStart = i + scLen;
    const nalType = data[nalStart] & 0x1f;
    if (nalType === 7 && nalStart + 3 < data.length) {
      const profile = data[nalStart + 1];
      const constraints = data[nalStart + 2];
      let level = data[nalStart + 3];
      if (level < 0x1f) level = 0x33; // clamp low/invalid levels up to 5.1
      const hex = (n: number) => n.toString(16).padStart(2, "0");
      return `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`;
    }
    i = nextStartCode(data, nalStart);
  }
  return null;
}

/** Offset of the first Annex-B start code, or -1. */
function firstStartCode(data: Uint8Array): number {
  return nextStartCode(data, 0);
}
function nextStartCode(data: Uint8Array, from: number): number {
  for (let i = Math.max(0, from); i + 3 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) return i;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) return i;
  }
  return -1;
}

/**
 * WebCodecs decoder. scrcpy emits an Annex-B byte stream and sends the codec
 * config (SPS/PPS) as its own packet before the first keyframe. WebCodecs needs
 * the SPS/PPS to accompany the keyframe, so we buffer the config bytes and
 * prepend them to the next key frame.
 */
export class WebCodecsDecoder implements Decoder {
  private decoder: VideoDecoder;
  private ctx: CanvasRenderingContext2D | null;
  private configured = false;
  private codec: string;
  private reported = false;
  private sawKeyframe = false;

  constructor(
    private canvas: HTMLCanvasElement,
    codec: string,
    private onSize?: (w: number, h: number) => void,
    private onLog?: (msg: string) => void,
  ) {
    this.ctx = canvas.getContext("2d");
    this.codec = codec;
    this.decoder = new (globalThis as any).VideoDecoder({
      output: (frame: VideoFrame) => this.render(frame),
      error: (e: DOMException) => this.onLog?.(`decoder error: ${e.message}`),
    });
  }

  private render(frame: VideoFrame) {
    if (!this.reported) {
      this.reported = true;
      this.onSize?.(frame.displayWidth, frame.displayHeight);
      this.onLog?.(`first frame ${frame.displayWidth}x${frame.displayHeight}`);
    }
    if (this.ctx) {
      if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
        this.canvas.width = frame.displayWidth;
        this.canvas.height = frame.displayHeight;
      }
      this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    }
    frame.close();
  }

  decode(data: Uint8Array, config: boolean, key: boolean, pts: number) {
    // Configure the decoder on the first config packet.
    if (config && !this.configured) {
      const off0 = firstStartCode(data);
      const cfgData = off0 > 0 ? data.subarray(off0) : data;
      let codecStr = codecString(this.codec);
      if (this.codec === "h264") {
        const fromSps = avcCodecFromSps(cfgData);
        if (fromSps) codecStr = fromSps;
      }
      try {
        this.decoder.configure({
          codec: codecStr,
          optimizeForLatency: true,
          hardwareAcceleration: "prefer-hardware",
        } as VideoDecoderConfig);
        this.configured = true;
        this.onLog?.(`configured ${codecStr}`);
      } catch (e) {
        this.onLog?.(`configure failed: ${String(e)}`);
      }
    }
    if (!this.configured) return;

    // scrcpy's "config" packet carries SPS+PPS AND the first IDR keyframe
    // together, so it IS a decodable keyframe — never drop it. Subsequent
    // keyframes are flagged `key`; everything else is a delta.
    const isKey = config || key;
    if (isKey) this.sawKeyframe = true;
    if (!this.sawKeyframe) return; // wait until we have a keyframe to start

    // Strip any bytes before the first Annex-B start code (scrcpy may prepend
    // a small header to the config packet).
    const off = firstStartCode(data);
    const payload = off > 0 ? data.subarray(off) : data;

    try {
      const chunk = new (globalThis as any).EncodedVideoChunk({
        type: isKey ? "key" : "delta",
        timestamp: pts,
        data: payload,
      });
      this.decoder.decode(chunk);
    } catch (e) {
      this.onLog?.(`decode failed: ${String(e)}`);
    }
  }

  close() {
    try {
      this.decoder.close();
    } catch {
      /* ignore */
    }
  }
}
