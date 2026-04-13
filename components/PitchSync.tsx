'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlaySummary, PitchSummary } from '@/app/types';
import type { AudioEngine } from '@/lib/audioEngine';

interface Props {
  play: PlaySummary;
  pitch: PitchSummary;
  audioEngine: AudioEngine | null;
  onApply: (offsetSeconds: number) => void;
  onCancel: () => void;
}

type Step =
  | 'waiting'       // waiting for user to tap when they see the pitch on TV
  | 'detecting'     // TV tapped — scanning radio buffer for transient
  | 'found'         // transient found — show calculated offset
  | 'notfound'      // detection timed out — show manual radio-tap fallback
  | 'manual'        // waiting for user to tap when they hear it on radio
  | 'manual_done';  // manual radio tap recorded — show offset

const DETECT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

export default function PitchSync({ play, pitch, audioEngine, onApply, onCancel }: Props) {
  const [step, setStep] = useState<Step>('waiting');
  const [tvTapTime, setTvTapTime] = useState<number | null>(null);
  const [transientTime, setTransientTime] = useState<number | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);

  const pitchLabel = `${pitch.balls}-${pitch.strikes} · ${pitch.description}`;

  // ── Auto-detection polling after TV tap ───────────────────────────────────
  useEffect(() => {
    if (step !== 'detecting' || tvTapTime === null) return;

    elapsedRef.current = 0;
    setElapsed(0);

    const interval = setInterval(() => {
      elapsedRef.current += POLL_INTERVAL_MS;
      setElapsed(elapsedRef.current);

      // Look back 30 s before tap + progressively further forward as time passes
      const lookaheadMs = elapsedRef.current;
      const t = audioEngine?.findTransientNear(tvTapTime, 30_000, lookaheadMs) ?? null;

      if (t !== null) {
        clearInterval(interval);
        setTransientTime(t);
        const offsetSeconds = (tvTapTime - t) / 1000;
        setOffset(offsetSeconds);
        setStep('found');
        return;
      }

      if (elapsedRef.current >= DETECT_TIMEOUT_MS) {
        clearInterval(interval);
        setStep('notfound');
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [step, tvTapTime, audioEngine]);

  const handleTvTap = useCallback(() => {
    setTvTapTime(Date.now());
    setStep('detecting');
  }, []);

  const handleManualRadioTap = useCallback(() => {
    if (tvTapTime === null) return;
    const radioTapTime = Date.now();
    const offsetSeconds = (tvTapTime - radioTapTime) / 1000;
    setOffset(offsetSeconds);
    setStep('manual_done');
  }, [tvTapTime]);

  const handleApply = useCallback(() => {
    if (offset !== null) onApply(offset);
  }, [offset, onApply]);

  const handleRetry = useCallback(() => {
    setStep('waiting');
    setTvTapTime(null);
    setTransientTime(null);
    setOffset(null);
    setElapsed(0);
    elapsedRef.current = 0;
  }, []);

  const detectSeconds = (elapsed / 1000).toFixed(1);
  const offsetSign = offset !== null && offset >= 0 ? '+' : '';
  const offsetLabel = offset !== null ? `${offsetSign}${offset.toFixed(2)}s` : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-sm mx-4 mb-6 sm:mb-0 rounded-2xl border border-slate-700 flex flex-col gap-5 p-6"
        style={{ background: '#0d1f3c' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-1">
              Pitch Sync
            </p>
            <p className="text-slate-200 text-sm font-semibold leading-snug">
              {play.batter}
            </p>
            <p className="text-slate-400 text-xs mt-0.5">{pitchLabel}</p>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-600 hover:text-slate-400 text-xl leading-none flex-shrink-0 mt-0.5"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>

        {/* ── Step: waiting ── */}
        {step === 'waiting' && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-slate-300 text-sm leading-relaxed">
              Watch your TV. Tap the button the instant you see this pitch.
            </p>
            <button
              onPointerDown={handleTvTap}
              className="w-full py-6 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-lg tracking-wide transition-all duration-100 select-none touch-none"
            >
              TAP — I SEE IT
            </button>
            <p className="text-center text-xs text-slate-600">
              Tap precisely when the ball hits the mitt on TV
            </p>
          </div>
        )}

        {/* ── Step: detecting ── */}
        {step === 'detecting' && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-12 h-12 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <p className="text-slate-300 text-sm text-center">
              Scanning radio audio for mitt sound…
            </p>
            <p className="text-slate-600 text-xs tabular-nums">
              {detectSeconds}s / {(DETECT_TIMEOUT_MS / 1000).toFixed(0)}s
            </p>
          </div>
        )}

        {/* ── Step: found ── */}
        {step === 'found' && offset !== null && transientTime !== null && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-1 py-2">
              <span className="text-green-400 text-xs font-semibold tracking-widest uppercase">
                Mitt sound detected
              </span>
              <span className="text-white text-4xl font-mono font-bold tabular-nums mt-1">
                {offsetLabel}
              </span>
              <span className="text-slate-500 text-xs">
                {offset >= 0 ? 'radio delay' : 'radio advanced'}
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRetry}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-400 text-sm font-medium hover:text-white hover:border-slate-400 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={handleApply}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold text-sm tracking-wide transition-all duration-100"
              >
                APPLY
              </button>
            </div>
          </div>
        )}

        {/* ── Step: notfound → manual fallback ── */}
        {step === 'notfound' && (
          <div className="flex flex-col gap-4">
            <p className="text-center text-slate-400 text-sm leading-relaxed">
              Couldn&apos;t detect automatically. Tap when you{' '}
              <span className="text-white font-semibold">hear</span> this pitch on radio.
            </p>
            <button
              onPointerDown={handleManualRadioTap}
              className="w-full py-5 rounded-xl bg-orange-600 hover:bg-orange-500 active:scale-95 text-white font-bold text-base tracking-wide transition-all duration-100 select-none touch-none"
            >
              TAP — I HEAR IT
            </button>
            <button
              onClick={handleRetry}
              className="text-slate-600 text-xs underline underline-offset-2 hover:text-slate-400 transition-colors text-center"
            >
              Try detection again
            </button>
          </div>
        )}

        {/* ── Step: manual ── (shouldn't render but guard for completeness) */}
        {step === 'manual' && (
          <div className="flex flex-col items-center gap-4 py-2">
            <p className="text-slate-400 text-sm text-center">
              Waiting for your radio tap…
            </p>
          </div>
        )}

        {/* ── Step: manual_done ── */}
        {step === 'manual_done' && offset !== null && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-1 py-2">
              <span className="text-orange-400 text-xs font-semibold tracking-widest uppercase">
                Manual sync
              </span>
              <span className="text-white text-4xl font-mono font-bold tabular-nums mt-1">
                {offsetLabel}
              </span>
              <span className="text-slate-500 text-xs">
                {offset >= 0 ? 'radio delay' : 'radio advanced'}
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRetry}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-400 text-sm font-medium hover:text-white hover:border-slate-400 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={handleApply}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold text-sm tracking-wide transition-all duration-100"
              >
                APPLY
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
