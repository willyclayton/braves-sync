'use client';

import { useState, useMemo } from 'react';
import type { PlaySummary, GameRouteResponse } from '@/app/types';

interface Props {
  game: GameRouteResponse;
  onSync: (offsetSeconds: number) => void;
}

const ORDINALS: Record<number, string> = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
  6: '6th', 7: '7th', 8: '8th', 9: '9th', 10: '10th',
  11: '11th', 12: '12th',
};

function ordinal(n: number) {
  return ORDINALS[n] ?? `${n}th`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
  } catch {
    return '';
  }
}

function scoringIcon(play: PlaySummary): string {
  if (play.result.includes('Home Run')) return '💥';
  if (play.isScoringPlay) return '🏃';
  return '';
}

interface InningGroup {
  key: string;
  inning: number;
  halfInning: 'top' | 'bottom';
  label: string;
  plays: PlaySummary[];
}

export default function GameTimeline({ game, onSync }: Props) {
  const [selected, setSelected] = useState<PlaySummary | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    // Default: expand the most recent 2 inning halves
    return new Set();
  });

  const groups: InningGroup[] = useMemo(() => {
    // Show last 3 innings worth of plays
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

    // Sort: most recent inning-half first
    return Array.from(map.values()).sort((a, b) => {
      if (b.inning !== a.inning) return b.inning - a.inning;
      return a.halfInning === 'top' ? 1 : -1; // bottom before top within same inning
    });
  }, [game.plays, game.currentInning]);

  // Auto-expand the first (most recent) group
  const firstKey = groups[0]?.key;
  const effectiveExpanded = useMemo(() => {
    if (expandedKeys.size > 0) return expandedKeys;
    return new Set(firstKey ? [firstKey] : []);
  }, [expandedKeys, firstKey]);

  function toggleInning(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSelect(play: PlaySummary) {
    setSelected(play);
  }

  function handleApply() {
    if (!selected || !selected.startTime) return;
    const playTime = Date.parse(selected.startTime);
    if (isNaN(playTime)) return;
    const tvDelaySeconds = (Date.now() - playTime) / 1000;
    onSync(tvDelaySeconds);
  }

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
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        Play data unavailable. Try Tap Sync.
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <p className="text-slate-400 text-sm text-center">
        Tap the play currently visible on TV.
      </p>

      <div className="flex flex-col gap-1 max-h-72 overflow-y-auto rounded-xl border border-slate-700 divide-y divide-slate-800">
        {groups.map((group) => {
          const isOpen = effectiveExpanded.has(group.key);
          return (
            <div key={group.key}>
              {/* Inning header */}
              <button
                onClick={() => toggleInning(group.key)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700/80 transition-colors text-left"
              >
                <span className="text-xs font-bold tracking-wider text-slate-300 uppercase">
                  {group.label}
                </span>
                <span className="text-slate-500 text-xs">{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Plays */}
              {isOpen &&
                group.plays.map((play) => {
                  const isSelected = selected?.atBatIndex === play.atBatIndex;
                  return (
                    <button
                      key={play.atBatIndex}
                      onClick={() => handleSelect(play)}
                      className={`
                        w-full text-left px-4 py-3 flex items-start gap-3
                        transition-colors
                        ${isSelected
                          ? 'bg-sky-900/40 border-l-2 border-sky-400'
                          : 'hover:bg-slate-700/30 border-l-2 border-transparent'}
                      `}
                    >
                      <div className="w-5 flex-shrink-0 text-center">
                        {isSelected
                          ? <span className="text-sky-400 text-sm">✓</span>
                          : <span className="text-base">{scoringIcon(play)}</span>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-sm font-semibold ${isSelected ? 'text-sky-300' : 'text-slate-200'}`}>
                            {play.batter}
                          </span>
                          <span className={`text-xs ${play.isScoringPlay ? 'text-yellow-400' : 'text-slate-400'}`}>
                            {play.result}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {play.description}
                        </div>
                      </div>
                      <span className="text-xs text-slate-600 flex-shrink-0 mt-0.5">
                        {formatTime(play.startTime)}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="flex flex-col gap-3">
          <div className="text-center text-sm text-slate-400">
            <span className="text-white">{selected.batter}</span> — {selected.result}
            {selected.startTime && (
              <span className="text-slate-500 ml-2">{formatTime(selected.startTime)}</span>
            )}
          </div>
          <button
            onClick={handleApply}
            className="w-full bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold text-sm tracking-wider py-3 rounded-xl transition-all duration-150"
          >
            SYNC TO THIS PLAY
          </button>
          <p className="text-center text-xs text-slate-600">
            Approximate sync — fine-tune with Tap Sync if needed
          </p>
        </div>
      )}
    </div>
  );
}
