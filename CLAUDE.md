# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

No test suite exists. Verification is manual in the browser.

## What This App Does

SyncCast is a Next.js 15 PWA that syncs 680 the Fan radio (audio in browser) with a Braves TV broadcast (TV ahead of radio by N seconds). The core problem: radio and TV are offset by a variable delay. The app measures that delay and compensates by inserting a `DelayNode` on the radio audio.

## Audio Architecture

The audio graph in `lib/audioEngine.ts`:

```
HTMLAudioElement (proxied stream)
  → MediaElementSourceNode
    → DelayNode (max 120s)   ← sync applied here for positive offsets
    → GainNode
    → AudioContext.destination (speakers)
  → AnalyserNode             ← transient detection (non-destructive tap)
  → MediaStreamDestinationNode ← for transcription (lazy, on demand)
```

**Sync offset math:**
- Radio ahead of TV (positive offset, common case): `DelayNode.delayTime = offsetSeconds`
- Radio behind TV (negative offset): seek `audio.currentTime` forward, or reconnect to live edge

**iOS Safari critical quirks** — do not break these:
- `crossOrigin = 'anonymous'` must be set *before* `audio.src`
- `AudioContext` must be created *inside* a user gesture handler (no `await` before `.play()`)
- `ScriptProcessorNode` is dead — use `AnalyserNode` + `setInterval` polling instead
- `playsinline` attribute required

## Radio Stream Proxy

`app/api/stream/route.ts` runs on **Edge Runtime** (no timeout) and proxies the stream with CORS headers. It tries 4 fallback candidates — station IDs change without notice. The proxy is required because radio CDNs don't set `Access-Control-Allow-Origin: *`.

## Sync Methods

Four methods live in `components/`, all share the same `onSync(offsetSeconds: number)` callback into `page.tsx`:

| Component | Method | Formula |
|---|---|---|
| `TapSync` | User taps radio event, then taps when seen on TV | `(tvTap - radioTap) / 1000` |
| `GameTimeline` | Click a pitch from MLB Stats API timeline | `(Date.now() - pitch.startTime) / 1000` |
| `PitchSync` | Transient detection on ball-impact sound | Scans `AnalyserNode` buffer for peak near tap time |
| `CountMatchSync` | Record radio → Deepgram → fuzzy match batter+count | `(Date.now() - chunkCapturedAt) / 1000` |

`PitchSync` is fragile — always has a manual tap fallback. `GameTimeline` is most reliable for live games. `CountMatchSync` requires `DEEPGRAM_API_KEY`.

## State Machine (`app/page.tsx`)

```
idle → starting → streaming → synced
                     ↓
                   error
```

`streaming` state shows the sync method tabs. `synced` shows the offset scrubber (±120s) with ±0.1s and ±1s nudge buttons. The scrubber operates in "preview" mode — offset isn't applied until the user hits JUMP.

`engineRef` is a `useRef<AudioEngine>` that's passed down to components that need audio access (`CountMatchSync`). Don't recreate the engine; always tear down + restart via `engine.start()`.

## MLB Stats API

Free, unauthenticated. Braves team ID: `144`.

```
/api/game route fetches:
  statsapi.mlb.com/api/v1/schedule  →  get gamePk for today
  statsapi.mlb.com/api/v1/game/{gamePk}/playByPlay  →  pitch-level data
```

Polled every 30s during live games. `PitchSummary.startTime` is the key field — it's the ISO 8601 timestamp used to calculate sync offset.

## Environment Variables

```
DEEPGRAM_API_KEY   # Required only for Count Match sync tab (Deepgram pre-recorded API)
```

All other functionality works without any env vars. Add to `.env.local` for local dev and Vercel project settings for production.

## CountMatchSync Flow

1. Tab opens → `MediaRecorder` starts on a tee'd `MediaStreamDestinationNode` from the audio graph
2. Every 5s: chunk POSTed to `/api/transcribe` → Deepgram → transcript text stored in rolling buffer (~3 min, capped at 36 chunks)
3. User clicks a pitch from the game timeline (batter + count visible on TV)
4. Fuzzy score search: last name match (+3) + count match (+2) — needs ≥4 to sync
5. Match found → `offset = (Date.now() - chunk.capturedAt) / 1000` → `onSync()`
6. Recorder stops after match or 3 minutes (auto-stop)
7. `capturedAt` is `Date.now() - 2500` (midpoint heuristic — phrase likely said mid-chunk)
