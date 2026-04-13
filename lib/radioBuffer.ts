/**
 * RadioBuffer — captures the last N seconds of radio stream audio,
 * downsampled to targetSampleRate (default 4 kHz).
 *
 * Audio path:
 *   mediaElementSource → radioBuffer.inputNode (ScriptProcessorNode)
 *                      → radioBuffer.outputNode (same node, passes audio through)
 *                      → gainNode → destination
 *
 * NOTE: ScriptProcessorNode is deprecated but remains the most compatible option
 * for synchronous PCM capture across iOS Safari 14.5+, Android Chrome, and
 * desktop browsers. AudioWorklet would be preferred in future iterations.
 */
export class RadioBuffer {
  /** Connect the upstream audio source to this node. */
  public readonly inputNode: ScriptProcessorNode;
  /** Connect this node to the downstream audio graph (gain → destination). */
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

    // bufferSize must be a power of 2 between 256 and 16384
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);
      // Pass audio through so the main chain (gain → speakers) still works
      output.set(input);
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

  /** How many downsampled samples have been written (capped at capacity). */
  get filledSamples(): number {
    return Math.min(this.writePos, this.capacity);
  }

  /** Seconds of audio currently buffered. */
  get filledSeconds(): number {
    return this.filledSamples / this.targetRate;
  }

  /**
   * Return the most recent `numSamples` in chronological order.
   * If fewer samples are available, returns all of them.
   */
  getRecent(numSamples: number): Float32Array {
    const available = this.filledSamples;
    const n = Math.min(numSamples, available);
    if (n === 0) return new Float32Array(0);

    const result = new Float32Array(n);
    const head = this.writePos % this.capacity; // next-write position = oldest after wrap

    for (let i = 0; i < n; i++) {
      // Walk backward from most-recent: writePos-1, writePos-2, …
      const srcIdx = ((this.writePos - n + i) % this.capacity + this.capacity) % this.capacity;
      result[i] = this.buf[srcIdx];
    }
    return result;
  }
}
