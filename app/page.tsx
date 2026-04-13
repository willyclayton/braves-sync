'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import VolumeSlider from '@/components/VolumeSlider';
import TapSync from '@/components/TapSync';
import GameTimeline from '@/components/GameTimeline';
import { AudioEngine } from '@/lib/audioEngine';
import type { AppState, GameRouteResponse } from './types';

type SyncTab = 'tap' | 'timeline';

const EMPTY_GAME: GameRouteResponse = {
  gamePk: null,
  gameState: 'NoGame',
  currentInning: 1,
  currentInningOrdinal: '1st',
  inningHalf: 'Top',
  awayTeam: 'ATL',
  homeTeam: '',
  awayScore: 0,
  homeScore: 0,
  plays: [],
};

export default function Home() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [volume, setVolume] = useState(0.8);
  const [offset, setOffset] = useState<number | null>(null);
  const [syncTab, setSyncTab] = useState<SyncTab>('tap');
  const [gameData, setGameData] = useState<GameRouteResponse>(EMPTY_GAME);
  const [gameLoading, setGameLoading] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);

  // ── Fetch game data ────────────────────────────────────────────────────────
  const fetchGame = useCallback(() => {
    setGameLoading(true);
    fetch('/api/game')
      .then((r) => r.json())
      .then((data: GameRouteResponse) => { setGameData(data); })
      .catch(() => {})
      .finally(() => setGameLoading(false));
  }, []);

  useEffect(() => {
    fetchGame();
  }, [fetchGame]);

  // ── Start radio ────────────────────────────────────────────────────────────
  const startRadio = useCallback(async () => {
    setErrorMsg('');
    setOffset(null);
    setAppState('starting');

    if (!engineRef.current) {
      engineRef.current = new AudioEngine();
    }

    try {
      await engineRef.current.start('/api/stream', volume);
      setAppState('streaming');
    } catch (err: unknown) {
      console.error('[SyncCast] start error', err);
      engineRef.current?.teardown();
      const name = err instanceof Error ? err.name : '';
      const msg = err instanceof Error ? err.message : String(err);
      if (name === 'NotAllowedError') {
        setErrorMsg('Playback blocked. Tap the button again to start.');
      } else if (name === 'NotSupportedError') {
        setErrorMsg(`Audio format not supported: ${msg}`);
      } else if (name === 'AbortError') {
        setErrorMsg('Playback was interrupted. Tap to try again.');
      } else {
        setErrorMsg(`Failed to start (${name || 'error'}: ${msg})`);
      }
      setAppState('error');
    }
  }, [volume]);

  // ── Apply sync offset ──────────────────────────────────────────────────────
  const applySync = useCallback((offsetSeconds: number) => {
    engineRef.current?.applyOffset(offsetSeconds);
    setOffset(offsetSeconds);
    setAppState('synced');
  }, []);

  // Fine-tune: adjust offset without leaving synced state
  const adjustOffset = useCallback((newOffset: number) => {
    const clamped = Math.round(newOffset * 10) / 10; // snap to 0.1s
    engineRef.current?.applyOffset(clamped);
    setOffset(clamped);
  }, []);

  // ── Volume change ──────────────────────────────────────────────────────────
  const handleVolumeChange = useCallback((v: number) => {
    setVolume(v);
    engineRef.current?.setVolume(v);
  }, []);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    engineRef.current?.teardown();
    setAppState('idle');
    setOffset(null);
  }, []);

  // ── Re-sync (go back to sync panel) ───────────────────────────────────────
  const handleResync = useCallback(() => {
    // Keep radio playing, just reset to sync selection
    engineRef.current?.applyOffset(0);
    setOffset(null);
    setAppState('streaming');
  }, []);

  const isActive = appState === 'streaming' || appState === 'synced';

  return (
    <main
      className="min-h-screen flex flex-col items-center gap-6 px-4 py-8 select-none"
      style={{ background: '#0a1628' }}
    >
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full bg-red-500 ${isActive ? 'animate-pulse' : 'opacity-40'}`} />
          <span className={`text-xs font-semibold tracking-widest uppercase ${isActive ? 'text-red-400' : 'text-slate-600'}`}>
            {isActive ? 'Live' : 'Off'}
          </span>
        </div>
        <h1 className="text-white text-5xl font-extrabold tracking-tight">SyncCast</h1>
        <p className="text-slate-400 text-sm">680 the Fan · Atlanta Braves</p>
      </div>

      {/* Game score bar */}
      {gameData.gameState !== 'NoGame' && gameData.homeTeam && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-800/60 border border-slate-700 text-sm">
          <span className="text-slate-300 font-medium">{gameData.awayTeam}</span>
          <span className="text-white font-bold tabular-nums">
            {gameData.awayScore} – {gameData.homeScore}
          </span>
          <span className="text-slate-300 font-medium">{gameData.homeTeam}</span>
          {gameData.gameState === 'Live' && (
            <span className="text-slate-500 text-xs ml-1">
              {gameData.inningHalf === 'Top' ? '▲' : '▼'}{gameData.currentInningOrdinal}
            </span>
          )}
          {gameData.gameState === 'Final' && (
            <span className="text-slate-500 text-xs ml-1">Final</span>
          )}
        </div>
      )}

      {/* ── Idle / Error ── */}
      {(appState === 'idle' || appState === 'error') && (
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={startRadio}
            className="relative flex items-center justify-center focus:outline-none group"
          >
            <span className="relative flex items-center justify-center w-40 h-40 rounded-full border-4 border-blue-500 bg-[#0d1f3c] group-active:scale-95 transition-all duration-300 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 mb-1 text-blue-400">
                <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
                <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z" />
              </svg>
              <span className="text-xs font-bold tracking-widest text-blue-400">
                {appState === 'error' ? 'TRY AGAIN' : 'START RADIO'}
              </span>
            </span>
          </button>
          {errorMsg && (
            <p className="text-red-400 text-sm text-center max-w-xs">{errorMsg}</p>
          )}
        </div>
      )}

      {/* ── Starting ── */}
      {appState === 'starting' && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-40 h-40 rounded-full border-4 border-yellow-400 bg-[#0d1f3c] flex flex-col items-center justify-center gap-1 animate-pulse">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 mb-1 text-yellow-400">
              <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
              <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z" />
            </svg>
            <span className="text-xs font-bold tracking-widest text-yellow-400">CONNECTING</span>
          </div>
        </div>
      )}

      {/* ── Streaming — sync panel ── */}
      {appState === 'streaming' && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <p className="text-center text-slate-300 text-sm font-medium">
            Radio is playing. Choose a sync method:
          </p>

          {/* Tab picker */}
          <div className="flex rounded-xl overflow-hidden border border-slate-700">
            <button
              onClick={() => setSyncTab('tap')}
              className={`flex-1 py-2.5 text-xs font-bold tracking-wider uppercase transition-colors ${
                syncTab === 'tap'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800/40 text-slate-500 hover:text-slate-300'
              }`}
            >
              Tap Sync
            </button>
            <button
              onClick={() => {
                setSyncTab('timeline');
                if (gameData.plays.length === 0 && gameData.gameState !== 'NoGame') fetchGame();
              }}
              className={`flex-1 py-2.5 text-xs font-bold tracking-wider uppercase transition-colors ${
                syncTab === 'timeline'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800/40 text-slate-500 hover:text-slate-300'
              }`}
            >
              Game Timeline
            </button>
          </div>

          {/* Tab content */}
          {syncTab === 'tap' && <TapSync onSync={applySync} />}
          {syncTab === 'timeline' && (
            gameLoading
              ? <p className="text-center text-slate-500 text-sm py-8">Loading game data…</p>
              : <GameTimeline game={gameData} onSync={applySync} />
          )}
        </div>
      )}

      {/* ── Synced ── */}
      {appState === 'synced' && offset !== null && (
        <div className="w-full max-w-sm flex flex-col gap-5">

          {/* Offset readout */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-green-400 text-xs font-semibold tracking-widest uppercase">✓ Synced</span>
            <span className="text-white text-4xl font-mono font-bold tabular-nums">
              {offset >= 0 ? '+' : ''}{offset.toFixed(1)}s
            </span>
            <span className="text-slate-500 text-xs">
              {offset >= 0 ? 'radio delay' : 'radio advanced'}
            </span>
          </div>

          {/* Scrubber */}
          <div className="flex flex-col gap-2">
            <input
              type="range"
              min={-30}
              max={120}
              step={0.1}
              value={offset}
              onChange={(e) => adjustOffset(parseFloat(e.target.value))}
              className="w-full h-2 rounded-full accent-green-500 cursor-pointer"
              aria-label="Sync offset"
            />
            <div className="flex justify-between text-xs text-slate-600">
              <span>−30s</span>
              <span>0</span>
              <span>+120s</span>
            </div>
          </div>

          {/* ±0.1 / ±1 nudge buttons */}
          <div className="grid grid-cols-4 gap-2">
            {([-1, -0.1, 0.1, 1] as const).map((delta) => (
              <button
                key={delta}
                onClick={() => adjustOffset(offset + delta)}
                className="py-2 rounded-lg border border-slate-700 text-slate-300 text-xs font-mono hover:bg-slate-700/50 active:scale-95 transition-all"
              >
                {delta > 0 ? '+' : ''}{delta.toFixed(delta % 1 === 0 ? 0 : 1)}s
              </button>
            ))}
          </div>

          {/* Re-sync actions */}
          <div className="flex gap-3">
            <button
              onClick={handleResync}
              className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-medium hover:text-white hover:border-slate-400 transition-colors"
            >
              Re-Sync
            </button>
            <button
              onClick={() => { handleResync(); setSyncTab('tap'); }}
              className="flex-1 py-2.5 rounded-xl border border-sky-700 text-sky-400 text-sm font-medium hover:bg-sky-900/20 transition-colors"
            >
              Tap Sync
            </button>
          </div>
        </div>
      )}

      {/* ── Volume + Stop (shown while radio is on) ── */}
      {isActive && (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <VolumeSlider value={volume} onChange={handleVolumeChange} />
          <button
            onClick={handleStop}
            className="text-slate-600 text-sm underline underline-offset-2 hover:text-slate-400 transition-colors text-center"
          >
            Stop radio
          </button>
        </div>
      )}
    </main>
  );
}
