'use client';

const BAR_COUNT = 12;

export default function AudioVisualizer({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="flex items-end gap-1 h-8" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full bg-yellow-400 origin-bottom"
          style={{
            animation: `waveform ${0.6 + (i % 5) * 0.1}s ease-in-out ${(i * 0.05).toFixed(2)}s infinite`,
            height: '100%',
          }}
        />
      ))}
    </div>
  );
}
