'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Called with the calculated offset in seconds when both taps are recorded.
   *  Positive = TV behind radio (delay radio). Negative = radio behind TV (seek forward). */
  onSync: (offsetSeconds: number) => void;
}

interface TapRecord {
  time: number;         // performance.now() timestamp
  label: string;        // e.g. "3.4s ago"
}

export default function TapSync({ onSync }: Props) {
  const [radioTap, setRadioTap] = useState<TapRecord | null>(null);
  const [tvTap, setTvTap] = useState<TapRecord | null>(null);
  // Debounce each button briefly to prevent double-taps
  const radioCooldown = useRef(false);
  const tvCooldown = useRef(false);
  // Tick state to refresh "X.Xs ago" labels
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  const elapsedLabel = (tap: TapRecord) => {
    const secs = (performance.now() - tap.time) / 1000;
    return `${secs.toFixed(1)}s ago`;
  };

  const handleRadio = useCallback(() => {
    if (radioCooldown.current) return;
    radioCooldown.current = true;
    setTimeout(() => { radioCooldown.current = false; }, 300);
    setRadioTap({ time: performance.now(), label: 'just now' });
  }, []);

  const handleTV = useCallback(() => {
    if (tvCooldown.current) return;
    tvCooldown.current = true;
    setTimeout(() => { tvCooldown.current = false; }, 300);
    setTvTap({ time: performance.now(), label: 'just now' });
  }, []);

  const handleApply = useCallback(() => {
    if (!radioTap || !tvTap) return;
    const offsetSeconds = (tvTap.time - radioTap.time) / 1000;
    onSync(offsetSeconds);
  }, [radioTap, tvTap, onSync]);

  const handleClear = useCallback(() => {
    setRadioTap(null);
    setTvTap(null);
  }, []);

  const bothTapped = radioTap !== null && tvTap !== null;
  const offsetPreview = bothTapped
    ? ((tvTap!.time - radioTap!.time) / 1000).toFixed(1)
    : null;

  return (
    <div className="w-full flex flex-col gap-5">
      <p className="text-slate-400 text-sm text-center leading-relaxed">
        Hear something distinctive?<br />
        Tap <span className="text-orange-400 font-semibold">RADIO</span> when you hear it on radio,
        then tap <span className="text-sky-400 font-semibold">TV</span> when you see it on TV.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {/* Radio tap button */}
        <button
          onTouchStart={handleRadio}
          onClick={handleRadio}
          className={`
            flex flex-col items-center justify-center gap-2
            rounded-2xl border-2 py-6 px-4
            transition-all duration-150 active:scale-95
            ${radioTap
              ? 'border-orange-500 bg-orange-500/10 text-orange-400'
              : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:border-orange-500/60'}
          `}
        >
          <span className="text-2xl">📻</span>
          <span className="text-xs font-bold tracking-widest uppercase">Radio</span>
          {radioTap ? (
            <span className="text-xs text-orange-300 font-medium">
              ✓ {elapsedLabel(radioTap)}
            </span>
          ) : (
            <span className="text-xs text-slate-500">tap to mark</span>
          )}
        </button>

        {/* TV tap button */}
        <button
          onTouchStart={handleTV}
          onClick={handleTV}
          className={`
            flex flex-col items-center justify-center gap-2
            rounded-2xl border-2 py-6 px-4
            transition-all duration-150 active:scale-95
            ${tvTap
              ? 'border-sky-500 bg-sky-500/10 text-sky-400'
              : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:border-sky-500/60'}
          `}
        >
          <span className="text-2xl">📺</span>
          <span className="text-xs font-bold tracking-widest uppercase">TV</span>
          {tvTap ? (
            <span className="text-xs text-sky-300 font-medium">
              ✓ {elapsedLabel(tvTap)}
            </span>
          ) : (
            <span className="text-xs text-slate-500">tap to mark</span>
          )}
        </button>
      </div>

      {/* Offset preview */}
      {bothTapped && offsetPreview !== null && (
        <p className="text-center text-sm text-slate-400">
          {parseFloat(offsetPreview) >= 0
            ? <>TV is <span className="text-white font-semibold">{offsetPreview}s</span> behind radio — will add delay</>
            : <>Radio is <span className="text-white font-semibold">{Math.abs(parseFloat(offsetPreview)).toFixed(1)}s</span> behind TV — will seek forward</>
          }
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {bothTapped && (
          <button
            onClick={handleApply}
            className="flex-1 bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold text-sm tracking-wider py-3 rounded-xl transition-all duration-150"
          >
            APPLY SYNC
          </button>
        )}
        {(radioTap || tvTap) && (
          <button
            onClick={handleClear}
            className="px-5 py-3 rounded-xl border border-slate-600 text-slate-400 text-sm hover:text-slate-200 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
