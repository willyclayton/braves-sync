/**
 * AudioEngine — manages the Web Audio graph for SyncCast.
 *
 * Graph:  Audio() → MediaElementSourceNode → DelayNode(180s) → GainNode → destination
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
  private delayNode: DelayNode | null = null;
  private gainNode: GainNode | null = null;
  private currentOffset = 0;

  /** Start the radio stream. Tears down any running graph first. */
  async start(streamUrl: string, volume: number): Promise<void> {
    this.teardown();

    // AudioContext must be created and resumed within a user-gesture call stack (iOS Safari)
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.resume();

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = streamUrl;
    audio.setAttribute('playsinline', '');
    audio.preload = 'none';
    this.audio = audio;

    const source = ctx.createMediaElementSource(audio);

    // Declare 180-second max at construction time — DelayNode clips silently if not set
    const delayNode = ctx.createDelay(180);
    delayNode.delayTime.value = 0;
    this.delayNode = delayNode;

    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    this.gainNode = gainNode;

    source.connect(delayNode);
    delayNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    await audio.play();
  }

  setVolume(v: number): void {
    if (this.gainNode) this.gainNode.gain.value = v;
  }

  /**
   * Apply a sync offset.
   *  offsetSeconds > 0 → TV is behind radio → delay radio output by that amount
   *  offsetSeconds < 0 → Radio is behind TV  → seek audio forward by |offset|
   */
  applyOffset(offsetSeconds: number): void {
    this.currentOffset = offsetSeconds;

    if (offsetSeconds >= 0) {
      if (this.delayNode) {
        this.delayNode.delayTime.value = Math.min(offsetSeconds, 170);
      }
    } else {
      // Reset delay, seek audio forward instead
      if (this.delayNode) this.delayNode.delayTime.value = 0;
      const audio = this.audio;
      if (audio) {
        const target = audio.currentTime + Math.abs(offsetSeconds);
        const seekTo =
          audio.seekable.length > 0
            ? Math.min(target, audio.seekable.end(0))
            : target;
        audio.currentTime = seekTo;
      }
    }
  }

  getCurrentOffset(): number {
    return this.currentOffset;
  }

  teardown(): void {
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
