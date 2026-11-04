// Plays the phone's audio in the mirror window.
//
// The backend forwards raw PCM from scrcpy (signed 16-bit little-endian, 48 kHz,
// stereo, whole 4-byte frames). We schedule each chunk back-to-back on a Web
// Audio clock. A small jitter buffer keeps playback smooth, and if the queue
// drifts too far ahead we drop chunks instead of letting latency build up.

const SAMPLE_RATE = 48000;
/** schedule this far ahead of "now" when (re)starting playback */
const START_LEAD = 0.06;
/** if playback is queued more than this far ahead, drop incoming audio */
const MAX_AHEAD = 0.35;

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    }
    return this.ctx;
  }

  /** Browsers start audio suspended until a user gesture; call this from one. */
  resume(): void {
    const ctx = this.ensure();
    if (ctx.state === "suspended") void ctx.resume();
  }

  push(chunk: ArrayBuffer): void {
    const ctx = this.ensure();
    if (ctx.state !== "running") return; // not allowed to play yet: drop, don't queue

    const samples = new Int16Array(chunk, 0, Math.floor(chunk.byteLength / 4) * 2);
    const frames = samples.length / 2;
    if (frames === 0) return;

    const now = ctx.currentTime;
    if (this.nextTime < now + 0.005) this.nextTime = now + START_LEAD; // underrun: re-buffer
    else if (this.nextTime > now + MAX_AHEAD) return; // too far ahead: shed load

    const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      left[i] = samples[2 * i] / 32768;
      right[i] = samples[2 * i + 1] / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.nextTime = 0;
  }
}
