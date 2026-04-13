/**
 * /api/stream — Proxy for the 680 the Fan (WCNN) audio stream.
 *
 * Why: iHeartRadio / StreamTheWorld streams don't send CORS headers,
 * so the browser's Web Audio API cannot tap into audio played directly
 * from their URL. By proxying through this route we add
 * Access-Control-Allow-Origin: * so createMediaElementSource() works.
 *
 * Edge Runtime is used so the response can stream indefinitely on
 * Vercel Hobby (Edge functions have no execution-time cap for streaming,
 * unlike the 10 s serverless function limit).
 *
 * Stream discovery order:
 *  1. WCNNAMAAC (AAC, iHeartRadio / StreamTheWorld — station rebranded WABO→WCNN)
 *  2. WCNNFMAAC  (alternate codec variant)
 *  3. WCNNAM     (MP3 fallback)
 *  4. TuneIn CDN MP3 (last resort)
 */

export const runtime = 'edge';

const STREAM_CANDIDATES = [
  'https://playerservices.streamtheworld.com/api/livestream-redirect/WCNNAMAAC.aac',
  'https://playerservices.streamtheworld.com/api/livestream-redirect/WCNNFMAAC.aac',
  'https://playerservices.streamtheworld.com/api/livestream-redirect/WCNNAM.mp3',
  'https://tunein.cdnstream1.com/4066_96.mp3',
];

export async function GET() {
  for (const url of STREAM_CANDIDATES) {
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          Referer: 'https://www.iheart.com/',
        },
        // follow the redirect chain to the actual stream endpoint
        redirect: 'follow',
      });

      if (!upstream.ok || !upstream.body) continue;

      const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg';

      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store',
          'X-Accel-Buffering': 'no', // disable nginx proxy buffering
          'Transfer-Encoding': 'chunked',
        },
      });
    } catch {
      // try next candidate
      continue;
    }
  }

  return new Response('Stream unavailable. The game may not be on or the stream URL has changed.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}
