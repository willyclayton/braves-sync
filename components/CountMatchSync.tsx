'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GameRouteResponse, PlaySummary, PitchSummary } from '@/app/types';
import type { AudioEngine } from '@/lib/audioEngine';

interface Props {
  game: GameRouteResponse;
  engineRef: React.RefObject<AudioEngine | null>;
  onSync: (offsetSeconds: number) => void;
}

type MatchStatus = 'recording' | 'searching' | 'matched' | 'notfound' | 'error';

interface TranscriptChunk {
  text: string;
  capturedAt: number;
}

function scoreMatch(
  text: string,
  batter: string,
  balls: number,
  strikes: number,
): number {
  let score = 0;
  const t = text.toLowerCase();
  const lastName = batter.split(' ').pop()?.toLowerCase() ?? '';
  if (lastName && t.includes(lastName)) score += 3;
  if (t.includes(`${balls}-${strikes}`) || t.includes(`${balls} and ${strikes}`)) score += 2;
  if (t.includes(String(balls))) score += 0.5;
  if (t.includes(String(strikes))) score += 0.5;
  return score;
}

function pitchDotColor(p: PitchSummary): string {
  if (p.isInPlay) return 'bg-yellow-400';
  if (p.isStrike) return 'bg-red-400';
  if (p.isBall) return 'bg-green-400';
  return 'bg-slate-500';
}

const ORDINALS: Record<number, string> = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
  6: '6th', 7: '7th', 8: '8th', 9: '9th', 10: '10th',
  11: '11th', 12: '12th',
};
function ordinal(n: number) { return ORDINALS[n] ?? `${n}th`; }

export default function CountMatchSync({ game, engineRef, onSync }: Props) {
  const [status, setStatus] = useState<MatchStatus>('recording');
  const [buffer, setBuffer] = useState<TranscriptChunk[]>([]);
  const [target, setTarget] = useState<{ play: PlaySummary; pitch: PitchSummary } | null>(null);
  const [expandedPlays, setExpandedPlays] = useState<Set<number>>(new Set());
  const [errorMsg, setErrorMsg] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const mimeTypeRef = useRef('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<MatchStatus>('recording');

  // Keep statusRef in sync for use inside closures
  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Start recording on mount ───────────────────────────────────────────────
  useEffect(() => {
    const stream = engineRef.current?.createTranscriptionStream();
    if (!stream) {
      setStatus('error');
      setErrorMsg('Audio engine not ready. Start radio first.');
      return;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
      .find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    mimeTypeRef.current = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setStatus('error');
      setErrorMsg('MediaRecorder not supported on this browser.');
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (e.data.size < 500) return;
      const capturedAt = Date.now() - 2500; // midpoint of 5s chunk
      try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': mimeTypeRef.current || 'audio/webm' },
          body: e.data,
        });
        const { transcript } = await res.json() as { transcript: string };
        if (!transcript) return;
        setBuffer((prev) => [
          ...prev.slice(-35), // ~3 minutes of buffer
          { text: transcript.toLowerCase(), capturedAt },
        ]);
      } catch {
        // Network error — skip this chunk silently
      }
    };

    recorder.onerror = () => {
      setStatus('error');
      setErrorMsg('Recording error.');
    };

    recorder.start(5000);

    // Auto-stop after 3 minutes to avoid Deepgram overuse
    const autoStop = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, 3 * 60 * 1000);

    return () => {
      clearTimeout(autoStop);
      if (recorder.state !== 'inactive') recorder.stop();
      recorderRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── When buffer updates, check if we're still searching ───────────────────
  useEffect(() => {
    if (statusRef.current !== 'searching' || !target) return;
    const lastChunk = buffer[buffer.length - 1];
    if (!lastChunk) return;
    const score = scoreMatch(lastChunk.text, target.play.batter, target.pitch.balls, target.pitch.strikes);
    if (score >= 4) {
      applyMatch(lastChunk.capturedAt);
    }
  }, [buffer]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyMatch = useCallback((capturedAt: number) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    recorderRef.current?.stop();
    const offsetSeconds = (Date.now() - capturedAt) / 1000;
    setStatus('matched');
    onSync(offsetSeconds);
  }, [onSync]);

  const handlePitchSelect = useCallback((play: PlaySummary, pitch: PitchSummary) => {
    if (statusRef.current === 'matched') return;
    setTarget({ play, pitch });
    setStatus('searching');

    // Search existing buffer
    const MIN_SCORE = 4;
    let best: { capturedAt: number; score: number } | null = null;
    for (const chunk of buffer) {
      const score = scoreMatch(chunk.text, play.batter, pitch.balls, pitch.strikes);
      if (score >= MIN_SCORE && (!best || score > best.score)) {
        best = { capturedAt: chunk.capturedAt, score };
      }
    }

    if (best) {
      applyMatch(best.capturedAt);
      return;
    }

    // Wait for upcoming chunks
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'searching') setStatus('notfound');
    }, 30_000);
  }, [buffer, applyMatch]);

  // ── Build play list from game data ────────────────────────────────────────
  const recentPlays = useMemo(() => {
    const minInning = Math.max(1, game.currentInning - 1);
    return game.plays
      .filter((p) => p.inning >= minInning)
      .slice(-8); // show last 8 at-bats max
  }, [game.plays, game.currentInning]);

  const togglePlay = (idx: number) => {
    setExpandedPlays((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="text-red-400 text-sm">{errorMsg || 'An error occurred.'}</span>
        <span className="text-slate-500 text-xs">Try Tap Sync or Game Timeline instead.</span>
      </div>
    );
  }

  if (game.gameState === 'NoGame' || game.plays.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="text-slate-400 text-sm">No live game data available.</span>
        <span className="text-slate-500 text-xs">Use Tap Sync or wait for game to start.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700">
        {status === 'recording' && (
          <>
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-slate-300 text-xs">Listening to radio — tap a pitch when you see it on TV</span>
          </>
        )}
        {status === 'searching' && target && (
          <>
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
            <span className="text-slate-300 text-xs">
              Looking for <span className="text-white font-medium">{target.pitch.balls}-{target.pitch.strikes} to {target.play.batter.split(' ').pop()}</span> in radio…
            </span>
          </>
        )}
        {status === 'notfound' && (
          <>
            <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
            <span className="text-slate-400 text-xs">Not found in radio — try a different pitch or use Tap Sync</span>
          </>
        )}
        {status === 'matched' && (
          <>
            <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            <span className="text-green-300 text-xs font-medium">Matched — syncing…</span>
          </>
        )}
      </div>

      {/* Pitch list */}
      <div className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
        {[...recentPlays].reverse().map((play) => {
          const isExpanded = expandedPlays.has(play.atBatIndex);
          return (
            <div key={play.atBatIndex} className="rounded-lg border border-slate-700 overflow-hidden">
              {/* At-bat header */}
              <button
                onClick={() => togglePlay(play.atBatIndex)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 transition-colors text-left"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-white text-xs font-semibold truncate">{play.batter}</span>
                  <span className="text-slate-500 text-xs">
                    {ordinal(play.inning)} · {play.halfInning === 'top' ? '▲' : '▼'} · {play.result || 'In progress'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Mini pitch dots */}
                  <div className="flex gap-0.5">
                    {play.pitches.slice(0, 6).map((p, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full ${pitchDotColor(p)}`} />
                    ))}
                    {play.pitches.length > 6 && (
                      <span className="text-slate-600 text-xs">+{play.pitches.length - 6}</span>
                    )}
                  </div>
                  <span className="text-slate-500 text-xs">{isExpanded ? '▴' : '▾'}</span>
                </div>
              </button>

              {/* Pitch detail list */}
              {isExpanded && (
                <div className="border-t border-slate-700/60">
                  {play.pitches.map((pitch) => {
                    const isTarget =
                      target?.play.atBatIndex === play.atBatIndex &&
                      target?.pitch.pitchNumber === pitch.pitchNumber;
                    return (
                      <button
                        key={pitch.pitchNumber}
                        onClick={() => handlePitchSelect(play, pitch)}
                        disabled={status === 'matched'}
                        className={`
                          w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                          ${isTarget
                            ? 'bg-blue-900/40 border-l-2 border-blue-500'
                            : 'hover:bg-slate-700/30 border-l-2 border-transparent'}
                        `}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${pitchDotColor(pitch)}`} />
                        <div className="flex flex-col gap-0 min-w-0 flex-1">
                          <span className="text-slate-200 text-xs">
                            <span className="font-mono font-bold text-white">{pitch.balls}-{pitch.strikes}</span>
                            {' · '}{pitch.description}
                          </span>
                        </div>
                        <span className="text-slate-500 text-xs shrink-0">Tap when seen</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* No API key notice */}
      {buffer.length === 0 && status === 'recording' && (
        <p className="text-slate-600 text-xs text-center">
          Chunks arrive every 5s · Requires <code className="text-slate-500">DEEPGRAM_API_KEY</code>
        </p>
      )}
    </div>
  );
}
