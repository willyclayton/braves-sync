/**
 * AudioEngine — manages the Web Audio graph for SyncCast.
 *
 * Graph:  Audio() → MediaElementSourceNode → DelayNode(180s) → GainNode → destination
 *                                         ↘ AnalyserNode (parallel tap, no output)
 *
 * Sync is applied via DelayNode.delayTime (positive offsets = TV behind radio)
 * or by seeking the audio element forward (negative offsets = radio behind TV).
 *
 * Calling start() tears down any previous graph before building a new one,
 * preventing the multiple-streams overlap bug.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private audio: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private delayNode: DelayNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private transcriptionDest: MediaStreamAudioDestinationNode | null = null;
  private samplingInterval: ReturnType<typeof setInterval> | null = null;
  private transientBuffer: Array<{ time: number; peak: number }> = [];
  private currentOffset = 0;

  /** Start the radio stream. Tears down any running graph first. */
  async start(streamUrl: string, volume: number): Promise<void> {
    this.teardown();

    // Create AudioContext synchronously within the user-gesture call stack.
    // Don't await resume() — iOS Safari considers the gesture stale after awaits,
    // and the context is already running when freshly created inside a gesture.
    const ctx = new AudioContext();
    this.ctx = ctx;
    ctx.resume().catch(() => {}); // fire-and-forget; needed if ctx starts suspended

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = streamUrl;
    audio.setAttribute('playsinline', '');
    this.audio = audio;

    // Build the audio graph before calling play() so routing is in place.
    const source = ctx.createMediaElementSource(audio);
    this.source = source;

    // 120-second max delay (spec: must be strictly less than 180).
    const delayNode = ctx.createDelay(120);
    delayNode.delayTime.value = 0;
    this.delayNode = delayNode;

    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    this.gainNode = gainNode;

    source.connect(delayNode);
    delayNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Parallel analyser tap for transient detection (doesn't affect output).
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);
    this.analyserNode = analyserNode;

    // Sample peak amplitude at ~20 Hz (every 50 ms).
    this.samplingInterval = setInterval(() => {
      if (!this.analyserNode) return;
      const data = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.analyserNode.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128);
        if (v > peak) peak = v;
      }
      const now = Date.now();
      this.transientBuffer.push({ time: now, peak });
      // Keep only the last 90 seconds.
      const cutoff = now - 90_000;
      while (this.transientBuffer.length > 0 && this.transientBuffer[0].time < cutoff) {
        this.transientBuffer.shift();
      }
    }, 50);

    // play() must be called while still within the user-gesture activation context.
    await audio.play();
  }

  setVolume(v: number): void {
    if (this.gainNode) this.gainNode.gain.value = v;
  }

  /**
   * Apply a sync offset.
   *  offsetSeconds > 0 → TV is behind radio → delay radio output by that amount
   *  offsetSeconds < 0 → Radio is behind TV  → seek or reconnect to live edge
   *
   * Uses setValueAtTime so the delay change is immediate with no interpolation.
   */
  applyOffset(offsetSeconds: number): void {
    this.currentOffset = offsetSeconds;

    if (offsetSeconds >= 0) {
      if (this.delayNode && this.ctx) {
        const clampedDelay = Math.min(offsetSeconds, 119); // safely under maxDelay=120
        this.delayNode.delayTime.cancelScheduledValues(this.ctx.currentTime);
        this.delayNode.delayTime.setValueAtTime(clampedDelay, this.ctx.currentTime);
      }
    } else {
      // Need to advance radio ahead of its current position.
      if (this.delayNode && this.ctx) {
        this.delayNode.delayTime.cancelScheduledValues(this.ctx.currentTime);
        this.delayNode.delayTime.setValueAtTime(0, this.ctx.currentTime);
      }
      const audio = this.audio;
      if (audio) {
        if (audio.seekable.length > 0) {
          // Seekable (HLS) — jump forward toward the live edge.
          const target = audio.currentTime + Math.abs(offsetSeconds);
          audio.currentTime = Math.min(target, audio.seekable.end(0));
        } else {
          // Plain live HTTP stream — not seekable. Reconnect to get the live edge.
          audio.load();
          audio.play().catch(() => {});
        }
      }
    }
  }

  getCurrentOffset(): number {
    return this.currentOffset;
  }

  /**
   * Find the most prominent transient (e.g. ball hitting catcher's mitt) near targetTime.
   *
   * Searches from (targetTime - lookbackMs) to (targetTime + lookaheadMs).
   * A transient is a sample whose peak is ≥ 30/128 AND at least 1.8× the rolling
   * average of the prior 4 samples.
   *
   * Returns the timestamp (ms) of the candidate closest to targetTime, or null if
   * none found.
   */
  findTransientNear(
    targetTime: number,
    lookbackMs = 30_000,
    lookaheadMs = 0,
  ): number | null {
    const windowStart = targetTime - lookbackMs;
    const windowEnd = targetTime + lookaheadMs;
    const slice = this.transientBuffer.filter(
      (s) => s.time >= windowStart && s.time <= windowEnd,
    );
    if (slice.length < 6) return null;

    const candidates: Array<{ time: number }> = [];
    for (let i = 4; i < slice.length; i++) {
      const baseline =
        (slice[i - 1].peak + slice[i - 2].peak + slice[i - 3].peak + slice[i - 4].peak) / 4;
      const peak = slice[i].peak;
      const rise = peak - baseline;
      if (peak >= 30 && rise >= 15 && peak > baseline * 1.5) {
        candidates.push({ time: slice[i].time });
      }
    }

    if (candidates.length === 0) return null;

    // Return the candidate closest to targetTime.
    candidates.sort((a, b) => Math.abs(a.time - targetTime) - Math.abs(b.time - targetTime));
    return candidates[0].time;
  }

  /**
   * Returns a MediaStream tapped directly from the radio source node (before delay).
   * Used by CountMatchSync to record audio chunks for transcription.
   * Lazily creates the MediaStreamDestinationNode on first call.
   */
  createTranscriptionStream(): MediaStream | null {
    if (!this.ctx || !this.source) return null;
    if (!this.transcriptionDest) {
      this.transcriptionDest = this.ctx.createMediaStreamDestination();
      this.source.connect(this.transcriptionDest);
    }
    return this.transcriptionDest.stream;
  }

  teardown(): void {
    if (this.samplingInterval !== null) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }
    this.analyserNode = null;
    this.transcriptionDest = null;
    this.source = null;
    this.transientBuffer = [];
    this.audio?.pause();
    this.audio = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.delayNode = null;
    this.gainNode = null;
    this.currentOffset = 0;
  }

  get isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }
}
