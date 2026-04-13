/**
 * MicBuffer — captures the last N seconds of microphone (TV) audio,
 * downsampled to targetSampleRate (default 4 kHz).
 *
 * Audio path:
 *   mediaStreamSource → micBuffer.inputNode (ScriptProcessorNode)
 *                     → micBuffer.outputNode → silentGain → destination
 *   (the silent sink keeps the ScriptProcessorNode active without outputting mic audio)
 */
export class MicBuffer {
  public readonly inputNode: ScriptProcessorNode;
  public readonly outputNode: ScriptProcessorNode;

  private readonly buf: Float32Array;
  private readonly capacity: number;
  private writePos = 0;
  private phase = 0;
  private readonly targetRate: number;
  private readonly sourceRate: number;

  constructor(ctx: AudioContext, durationSeconds: number, targetSampleRate = 4000) {
    this.targetRate = targetSampleRate;
    this.sourceRate = ctx.sampleRate;
    this.capacity = Math.ceil(durationSeconds * targetSampleRate);
    this.buf = new Float32Array(this.capacity);

    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // Silence the output — we do NOT want to hear the mic
      e.outputBuffer.getChannelData(0).fill(0);
      this.ingest(input);
    };

    this.inputNode = processor;
    this.outputNode = processor;
  }

  private ingest(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.phase += this.targetRate;
      if (this.phase >= this.sourceRate) {
        this.phase -= this.sourceRate;
        this.buf[this.writePos % this.capacity] = samples[i];
        this.writePos++;
      }
    }
  }

  get filledSamples(): number {
    return Math.min(this.writePos, this.capacity);
  }

  get filledSeconds(): number {
    return this.filledSamples / this.targetRate;
  }

  /**
   * Return the entire buffered mic audio in chronological order
   * (oldest sample first, newest sample last).
   */
  getAll(): Float32Array {
    const available = this.filledSamples;
    if (available === 0) return new Float32Array(0);

    const result = new Float32Array(available);
    const head = this.writePos % this.capacity;

    if (this.writePos < this.capacity) {
      // Buffer not yet full — data is contiguous from 0..writePos-1
      result.set(this.buf.subarray(0, available));
    } else {
      // Buffer full — oldest data starts at head
      result.set(this.buf.subarray(head), 0);
      result.set(this.buf.subarray(0, head), this.capacity - head);
    }
    return result;
  }
}
