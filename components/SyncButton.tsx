'use client';

import { type AppState } from '@/app/types';

interface Props {
  state: AppState;
  progress: number; // 0-100, used during buffering
  onClick: () => void;
}

const labels: Record<AppState, string> = {
  ready: 'SYNC NOW',
  buffering: 'LISTENING...',
  syncing: 'SYNCING...',
  synced: 'RE-SYNC',
  error: 'TRY AGAIN',
};

const ringColors: Record<AppState, string> = {
  ready: 'border-blue-500',
  buffering: 'border-yellow-400',
  syncing: 'border-yellow-400',
  synced: 'border-green-400',
  error: 'border-red-500',
};

const textColors: Record<AppState, string> = {
  ready: 'text-blue-400',
  buffering: 'text-yellow-300',
  syncing: 'text-yellow-300',
  synced: 'text-green-300',
  error: 'text-red-400',
};

const isSpinning = (state: AppState) => state === 'buffering' || state === 'syncing';
const isDisabled = (state: AppState) => state === 'buffering' || state === 'syncing';

export default function SyncButton({ state, progress, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={isDisabled(state)}
      className="relative flex items-center justify-center focus:outline-none group"
      aria-label={labels[state]}
    >
      {/* Outer pulsing ring (visible when synced) */}
      {state === 'synced' && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-20 animate-ping" />
      )}

      {/* Progress arc for buffering */}
      {state === 'buffering' && (
        <svg
          className="absolute w-44 h-44 -rotate-90"
          viewBox="0 0 176 176"
        >
          <circle
            cx="88"
            cy="88"
            r="82"
            fill="none"
            stroke="#facc15"
            strokeWidth="4"
            strokeOpacity="0.25"
          />
          <circle
            cx="88"
            cy="88"
            r="82"
            fill="none"
            stroke="#facc15"
            strokeWidth="4"
            strokeDasharray={`${2 * Math.PI * 82}`}
            strokeDashoffset={`${2 * Math.PI * 82 * (1 - progress / 100)}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
      )}

      {/* Main circle */}
      <span
        className={`
          relative flex items-center justify-center
          w-40 h-40 rounded-full
          border-4 ${ringColors[state]}
          bg-navy-800
          transition-all duration-300
          ${isSpinning(state) ? 'animate-pulse-slow' : ''}
          ${!isDisabled(state) ? 'group-active:scale-95 cursor-pointer' : 'cursor-default'}
        `}
        style={{ backgroundColor: '#0d1f3c' }}
      >
        {/* Mic icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`w-10 h-10 mb-1 ${textColors[state]}`}
        >
          <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
          <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z" />
        </svg>

        <span className={`text-xs font-bold tracking-widest ${textColors[state]}`}>
          {labels[state]}
        </span>
      </span>
    </button>
  );
}
