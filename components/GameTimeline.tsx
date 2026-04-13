'use client';

import { useState, useMemo } from 'react';
import type { PlaySummary, PitchSummary, GameRouteResponse } from '@/app/types';

interface Props {
  game: GameRouteResponse;
  onSync: (offsetSeconds: number) => void;
}

const ORDINALS: Record<number, string> = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
  6: '6th', 7: '7th', 8: '8th', 9: '9th', 10: '10th',
  11: '11th', 12: '12th',
};
function ordinal(n: number) { return ORDINALS[n] ?? `${n}th`; }

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    });
  } catch { return ''; }
}

function pitchDotColor(p: PitchSummary): string {
  if (p.isInPlay) return 'bg-yellow-400';
  if (p.isStrike) return 'bg-red-400';
  if (p.isBall)   return 'bg-green-400';
  return 'bg-slate-500';
}


type Selection =
  | { type: 'play'; play: PlaySummary }
  | { type: 'pitch'; play: PlaySummary; pitch: PitchSummary };

interface InningGroup {
  key: string;
  inning: number;
  halfInning: 'top' | 'bottom';
  label: string;
  plays: PlaySummary[];
}

export default function GameTimeline({ game, onSync }: Props) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [expandedPlays, setExpandedPlays] = useState<Set<number>>(new Set());
  const [expandedInnings, setExpandedInnings] = useState<Set<string>>(new Set());

  const groups: InningGroup[] = useMemo(() => {
    const minInning = Math.max(1, game.currentInning - 2);
    const filtered = game.plays.filter((p) => p.inning >= minInning);
    const map = new Map<string, InningGroup>();
    for (const play of filtered) {
      const key = `${play.inning}-${play.halfInning}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          inning: play.inning,
          halfInning: play.halfInning,
          label: `${play.halfInning === 'top' ? 'Top' : 'Bot'} ${ordinal(play.inning)}`,
          plays: [],
        });
      }
      map.get(key)!.plays.push(play);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.inning !== a.inning) return b.inning - a.inning;
      return a.halfInning === 'top' ? 1 : -1;
    });
  }, [game.plays, game.currentInning]);

  // Auto-expand the most recent inning group
  const firstKey = groups[0]?.key;
  const effectiveInnings = useMemo(
    () => expandedInnings.size > 0 ? expandedInnings : new Set(firstKey ? [firstKey] : []),
    [expandedInnings, firstKey],
  );

  function toggleInning(key: string) {
    setExpandedInnings((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function togglePlay(idx: number) {
    setExpandedPlays((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function handleApply() {
    if (!selected) return;
    const iso = selected.type === 'pitch' ? selected.pitch.startTime : selected.play.startTime;
    const t = Date.parse(iso);
    if (isNaN(t)) return;
    onSync((Date.now() - t) / 1000);
  }

  const selectedLabel = selected
    ? selected.type === 'pitch'
      ? `${selected.play.batter} — Pitch ${selected.pitch.pitchNumber} (${selected.pitch.balls}-${selected.pitch.strikes})`
      : `${selected.play.batter} — ${selected.play.result}`
    : null;

  if (game.gameState === 'NoGame' || game.gameState === 'Preview') {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        {game.gameState === 'Preview'
          ? "Game hasn't started yet — try Tap Sync once it begins."
          : 'No Braves game today. Try Tap Sync.'}
      </div>
    );
  }
  if (game.plays.length === 0) {
    return <div className="text-center py-8 text-slate-500 text-sm">Play data unavailable. Try Tap Sync.</div>;
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <p className="text-slate-400 text-sm text-center">
        Tap a play — or expand it to sync to a specific pitch.
      </p>

      <div className="flex flex-col max-h-80 overflow-y-auto rounded-xl border border-slate-700 divide-y divide-slate-800/60">
        {groups.map((group) => {
          const isOpen = effectiveInnings.has(group.key);
          return (
            <div key={group.key}>
              {/* Inning header */}
              <button
                onClick={() => toggleInning(group.key)}
                className="w-full flex items-center justify-between px-4 py-2 bg-slate-800 hover:bg-slate-700/80 transition-colors"
              >
                <span className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                  {group.label}
                </span>
                <span className="text-slate-500 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && group.plays.map((play) => {
                const isPlaySelected = selected?.type === 'play' && selected.play.atBatIndex === play.atBatIndex;
                const isExpanded = expandedPlays.has(play.atBatIndex);
                const hasPitches = play.pitches.length > 0;

                return (
                  <div key={play.atBatIndex}>
                    {/* Play row */}
                    <div className="flex items-stretch">
                      {/* Select play button */}
                      <button
                        onClick={() => setSelected({ type: 'play', play })}
                        className={`
                          flex-1 text-left px-4 py-2.5 flex items-start gap-2.5
                          border-l-2 transition-colors
                          ${isPlaySelected
                            ? 'border-sky-400 bg-sky-900/30'
                            : 'border-transparent hover:bg-slate-700/30'}
                        `}
                      >
                        <span className="w-4 flex-shrink-0 mt-0.5 text-center text-xs">
                          {isPlaySelected ? <span className="text-sky-400">✓</span> : (play.isScoringPlay ? '🏃' : '')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className={`text-sm font-semibold ${isPlaySelected ? 'text-sky-300' : 'text-slate-200'}`}>
                              {play.batter}
                            </span>
                            <span className={`text-xs ${play.isScoringPlay ? 'text-yellow-400' : 'text-slate-400'}`}>
                              {play.result}
                            </span>
                            {play.pitches.length > 0 && (
                              <span className="text-xs text-slate-600">
                                {play.pitches.length}p
                              </span>
                            )}
                          </div>
                          {/* Pitch count dots */}
                          {play.pitches.length > 0 && (
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {play.pitches.map((p) => (
                                <span
                                  key={p.pitchNumber}
                                  title={p.description}
                                  className={`inline-block w-2 h-2 rounded-full ${pitchDotColor(p)}`}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-slate-600 flex-shrink-0 mt-0.5">
                          {formatTime(play.startTime)}
                        </span>
                      </button>

                      {/* Expand pitches toggle */}
                      {hasPitches && (
                        <button
                          onClick={() => togglePlay(play.atBatIndex)}
                          className="px-3 flex items-center text-slate-600 hover:text-slate-300 transition-colors border-l border-slate-800/60"
                          title={isExpanded ? 'Hide pitches' : 'Show pitches'}
                        >
                          <span className="text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                      )}
                    </div>

                    {/* Pitch list */}
                    {isExpanded && play.pitches.map((pitch) => {
                      const isPitchSelected =
                        selected?.type === 'pitch' &&
                        selected.play.atBatIndex === play.atBatIndex &&
                        selected.pitch.pitchNumber === pitch.pitchNumber;

                      return (
                        <button
                          key={pitch.pitchNumber}
                          onClick={() => setSelected({ type: 'pitch', play, pitch })}
                          className={`
                            w-full text-left pl-10 pr-4 py-2 flex items-center gap-3
                            border-l-2 transition-colors
                            ${isPitchSelected
                              ? 'border-sky-400 bg-sky-900/20'
                              : 'border-transparent hover:bg-slate-700/20'}
                          `}
                        >
                          {/* Pitch dot */}
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${pitchDotColor(pitch)}`} />

                          {/* Pitch label: P3 · 1-2 · Called Strike */}
                          <span className="text-xs text-slate-500 flex-shrink-0 tabular-nums w-5">
                            P{pitch.pitchNumber}
                          </span>
                          <span className={`text-xs font-mono flex-shrink-0 tabular-nums ${
                            isPitchSelected ? 'text-sky-300' : 'text-slate-400'
                          }`}>
                            {pitch.balls}-{pitch.strikes}
                          </span>
                          <span className={`text-xs flex-1 truncate ${
                            isPitchSelected ? 'text-sky-200' : 'text-slate-400'
                          }`}>
                            {pitch.description}
                          </span>
                          <span className="text-xs text-slate-700 flex-shrink-0">
                            {formatTime(pitch.startTime)}
                          </span>
                          {isPitchSelected && <span className="text-sky-400 text-xs flex-shrink-0">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-xs text-slate-400 truncate px-2">{selectedLabel}</p>
          <button
            onClick={handleApply}
            className="w-full bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold text-sm tracking-wider py-3 rounded-xl transition-all duration-150"
          >
            SYNC TO THIS {selected.type === 'pitch' ? 'PITCH' : 'PLAY'}
          </button>
          <p className="text-center text-xs text-slate-600">
            Approximate — fine-tune with the scrubber or Tap Sync
          </p>
        </div>
      )}
    </div>
  );
}
