'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SyncButton from '@/components/SyncButton';
import AudioVisualizer from '@/components/AudioVisualizer';
import VolumeSlider from '@/components/VolumeSlider';
import { RadioBuffer } from '@/lib/radioBuffer';
import { MicBuffer } from '@/lib/micBuffer';
import { findSyncOffset } from '@/lib/audioSync';
import type { AppState } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────
const SAMPLE_RATE = 4000;          // downsampled rate for correlation
const RADIO_CLIP_SECS = 10;        // recent radio clip used for correlation
const MIC_BUFFER_SECS = 60;        // how much mic (TV) audio to keep
const RADIO_BUFFER_SECS = 60;      // how much radio audio to keep
const PRE_SYNC_SECS = 15;          // seconds to buffer before first auto-sync
const RESYNC_INTERVAL_MS = 3 * 60 * 1000; // re-sync every 3 minutes
const CONFIDENCE_THRESHOLD = 0.15;

export default function Home() {
  const [appState, setAppState] = useState<AppState>('ready');
  const [delay, setDelay] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [errorMsg, setErrorMsg] = useState('');
  const [bufferProgress, setBufferProgress] = useState(0);

  // Refs that survive re-renders without triggering them
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const radioBufferRef = useRef<RadioBuffer | null>(null);
  const micBufferRef = useRef<MicBuffer | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const resyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep a stable ref to performSync so setInterval closures don't go stale
  const performSyncRef = useRef<() => Promise<void>>(async () => {});

  // ─── Perform sync ─────────────────────────────────────────────────────────
  const performSync = useCallback(async () => {
    const radioBuffer = radioBufferRef.current;
    const micBuffer = micBufferRef.current;
    const audio = audioRef.current;
    if (!radioBuffer || !micBuffer || !audio) return;

    setAppState('syncing');

    try {
      const radioSamples = radioBuffer.getRecent(RADIO_CLIP_SECS * SAMPLE_RATE);
      const micSamples = micBuffer.getAll();

      if (radioSamples.length < RADIO_CLIP_SECS * SAMPLE_RATE * 0.5) {
        setErrorMsg('Not enough radio audio buffered yet. Please wait a moment.');
        setAppState('error');
        return;
      }
      if (micSamples.length < RADIO_CLIP_SECS * SAMPLE_RATE) {
        setErrorMsg('Not enough mic audio buffered yet. Please wait a moment.');
        setAppState('error');
        return;
      }

      const result = findSyncOffset(radioSamples, micSamples, SAMPLE_RATE);

      if (result.confidence < CONFIDENCE_THRESHOLD) {
        setErrorMsg(
          "Couldn't find a match. Make sure the game is on TV with the volume up, then try again.",
        );
        setAppState('error');
        return;
      }

      // Apply the offset by seeking the audio element
      const target = audio.currentTime + result.offsetSeconds;
      if (audio.seekable.length > 0) {
        const seekEnd = audio.seekable.end(0);
        audio.currentTime = Math.min(Math.max(0, target), seekEnd);
      } else {
        audio.currentTime = Math.max(0, target);
      }

      setDelay(result.offsetSeconds);
      setAppState('synced');
    } catch (err) {
      console.error('[SyncCast] sync error', err);
      setErrorMsg('Sync failed. Please try again.');
      setAppState('error');
    }
  }, []);

  // Keep the ref current so interval callbacks use the latest version
  useEffect(() => {
    performSyncRef.current = performSync;
  }, [performSync]);

  // ─── Tear-down ────────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    if (bufferTimerRef.current) {
      clearInterval(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    if (resyncTimerRef.current) {
      clearInterval(resyncTimerRef.current);
      resyncTimerRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
    // Close the AudioContext so createMediaElementSource can be called fresh on retry
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    gainRef.current = null;
    radioBufferRef.current = null;
    micBufferRef.current = null;
  }, []);

  // ─── Start buffering ───────────────────────────────────────────────────────
  const startBuffering = useCallback(async () => {
    setErrorMsg('');
    setBufferProgress(0);

    try {
      // Always create a fresh AudioContext and Audio element.
      // createMediaElementSource() can only be called once per <audio> element,
      // so we must use a new element on every attempt.
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.resume();

      // ── Radio audio graph ──────────────────────────────────────────────────
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = '/api/stream';
      audio.setAttribute('playsinline', '');
      audio.preload = 'none';
      audioRef.current = audio;

      const source = ctx.createMediaElementSource(audio);

      const gain = ctx.createGain();
      gain.gain.value = volume;
      gainRef.current = gain;

      const radioBuffer = new RadioBuffer(ctx, RADIO_BUFFER_SECS, SAMPLE_RATE);
      radioBufferRef.current = radioBuffer;

      // source → radioBuffer (ScriptProcessorNode) → gain → speakers
      source.connect(radioBuffer.inputNode);
      radioBuffer.outputNode.connect(gain);
      gain.connect(ctx.destination);

      // Verify the stream is actually reachable before committing
      try {
        await audio.play();
      } catch (playErr) {
        console.error('[SyncCast] stream play error', playErr);
        throw new Error('StreamError');
      }

      // ── Mic audio graph ────────────────────────────────────────────────────
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      micStreamRef.current = micStream;

      const micSource = ctx.createMediaStreamSource(micStream);
      const micBuffer = new MicBuffer(ctx, MIC_BUFFER_SECS, SAMPLE_RATE);
      micBufferRef.current = micBuffer;

      // Mic output must connect to destination (even silenced) to keep processor active
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(ctx.destination);

      micSource.connect(micBuffer.inputNode);
      micBuffer.outputNode.connect(silentGain);

      // ── Buffer progress ticker ─────────────────────────────────────────────
      setAppState('buffering');
      let elapsed = 0;
      bufferTimerRef.current = setInterval(() => {
        elapsed += 1;
        setBufferProgress(Math.min(100, (elapsed / PRE_SYNC_SECS) * 100));
        if (elapsed >= PRE_SYNC_SECS) {
          clearInterval(bufferTimerRef.current!);
          bufferTimerRef.current = null;
          performSyncRef.current();
        }
      }, 1000);
    } catch (err: unknown) {
      console.error('[SyncCast] start error', err);
      teardown();
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setErrorMsg('Microphone access denied. Please allow mic access and try again.');
      } else if (err instanceof Error && err.message === 'StreamError') {
        setErrorMsg('Radio stream unavailable. The game may not be on or the stream URL has changed.');
      } else {
        setErrorMsg('Failed to start. Check your internet connection and try again.');
      }
      setAppState('error');
    }
  }, [volume, teardown]);

  // ─── Button handler ────────────────────────────────────────────────────────
  const handleSyncClick = useCallback(() => {
    if (appState === 'ready' || appState === 'error') {
      startBuffering();
    } else if (appState === 'synced') {
      performSync();
    }
  }, [appState, startBuffering, performSync]);

  const handleStop = useCallback(() => {
    teardown();
    setAppState('ready');
    setDelay(null);
    setBufferProgress(0);
  }, [teardown]);

  const handleVolumeChange = useCallback(
    (v: number) => {
      setVolume(v);
      if (gainRef.current) gainRef.current.gain.value = v;
    },
    [],
  );

  // ─── Auto re-sync every 3 minutes once synced ──────────────────────────────
  useEffect(() => {
    if (appState !== 'synced') return;
    resyncTimerRef.current = setInterval(() => {
      performSyncRef.current();
    }, RESYNC_INTERVAL_MS);
    return () => {
      if (resyncTimerRef.current) clearInterval(resyncTimerRef.current);
    };
  }, [appState]);

  // ─── Wake lock — keep screen on while listening / synced ───────────────────
  useEffect(() => {
    if (appState !== 'buffering' && appState !== 'synced') return;
    let wakeLock: WakeLockSentinel | null = null;
    (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock
      ?.request('screen')
      .then((lock) => { wakeLock = lock; })
      .catch(() => {/* no-op — wake lock not supported or permission denied */});
    return () => { wakeLock?.release().catch(() => {}); };
  }, [appState]);

  // ─── Status text ──────────────────────────────────────────────────────────
  const statusText: Record<AppState, string> = {
    ready: 'Tap Sync to start',
    buffering: `Listening to your TV... (${Math.round(bufferProgress)}%)`,
    syncing: 'Calculating delay…',
    synced:
      delay !== null
        ? `Synced! Offset: ${delay > 0 ? '+' : ''}${delay.toFixed(1)}s`
        : 'Synced!',
    error: errorMsg || 'Something went wrong.',
  };

  const statusColor: Record<AppState, string> = {
    ready: 'text-slate-400',
    buffering: 'text-yellow-300',
    syncing: 'text-yellow-300',
    synced: 'text-green-400',
    error: 'text-red-400',
  };

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-12 select-none"
      style={{ background: '#0a1628' }}
    >
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-400 text-xs font-semibold tracking-widest uppercase">Live</span>
        </div>
        <h1 className="text-white text-5xl font-extrabold tracking-tight">SyncCast</h1>
        <p className="text-slate-400 text-sm">680 the Fan · Atlanta Braves</p>
      </div>

      {/* Sync button */}
      <SyncButton state={appState} progress={bufferProgress} onClick={handleSyncClick} />

      {/* Waveform animation during listening */}
      <AudioVisualizer active={appState === 'buffering'} />

      {/* Status */}
      <p className={`text-sm text-center max-w-xs ${statusColor[appState]}`}>
        {statusText[appState]}
      </p>

      {/* Volume control */}
      <VolumeSlider value={volume} onChange={handleVolumeChange} />

      {/* Stop button — shown when active */}
      {(appState === 'buffering' || appState === 'syncing' || appState === 'synced') && (
        <button
          onClick={handleStop}
          className="text-slate-500 text-sm underline underline-offset-2 hover:text-slate-300 transition-colors"
        >
          Stop
        </button>
      )}

      {/* Hidden audio element */}
      <audio ref={audioRef} playsInline />
    </main>
  );
}
