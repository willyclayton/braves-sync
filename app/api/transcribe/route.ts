export const runtime = 'nodejs';

export async function POST(req: Request) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return Response.json({ transcript: '' });
  }

  const contentType = req.headers.get('content-type') ?? 'audio/webm';
  const body = await req.arrayBuffer();

  const dgRes = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-2&language=en-US',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': contentType,
      },
      body,
    },
  );

  const data = await dgRes.json();
  const transcript =
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  return Response.json({ transcript });
}
