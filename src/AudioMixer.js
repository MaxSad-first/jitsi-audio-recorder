'use strict';

class AudioMixer {
  constructor({ sampleRate = 48000, frameMs = 20, onFrame }) {
    this.sampleRate = sampleRate;
    this.frameSize = Math.round((sampleRate * frameMs) / 1000);
    this.frameBytes = this.frameSize * 2;
    this.onFrame = onFrame;
    this.buffers = new Map();
    this._timer = null;
  }

  addParticipant(id) {
    this.buffers.set(id, Buffer.alloc(0));
  }

  removeParticipant(id) {
    this.buffers.delete(id);
  }

  pushSamples(id, samples) {
    if (!this.buffers.has(id)) return;
    const incoming = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    let buf = Buffer.concat([this.buffers.get(id), incoming]);

    const maxBytes = this.frameBytes * 50;
    if (buf.length > maxBytes) {
      buf = buf.subarray(buf.length - maxBytes);
    }
    this.buffers.set(id, buf);
  }

  start() {
    const { frameBytes, frameSize } = this;
    this._timer = setInterval(() => {
      const mixed = new Int32Array(frameSize);

      for (const [id, buf] of this.buffers.entries()) {
        if (buf.length < frameBytes) continue;
        for (let i = 0; i < frameSize; i++) {
          mixed[i] += buf.readInt16LE(i * 2);
        }
        this.buffers.set(id, buf.subarray(frameBytes));
      }

      const out = Buffer.alloc(frameBytes);
      for (let i = 0; i < frameSize; i++) {
        const clipped = Math.max(-32768, Math.min(32767, mixed[i]));
        out.writeInt16LE(clipped, i * 2);
      }

      this.onFrame(out);
    }, (frameSize / this.sampleRate) * 1000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

module.exports = AudioMixer;
