export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');
  const referer = searchParams.get('referer') || 'https://matcheslinkz.pages.dev/';
  const ua = searchParams.get('ua') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });
  }

  const headers = new Headers({
    'User-Agent': ua,
    'Accept': '*/*',
    'Referer': referer,
    'Origin': new URL(referer).origin,
  });

  const range = req.headers.get('range');
  if (range) headers.set('Range', range);

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type') || '';
    const isM3u8 = contentType.toLowerCase().includes('mpegurl') || targetUrl.toLowerCase().includes('.m3u8');

    const resHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });

    if (upstream.ok && isM3u8) {
      const text = await upstream.text();
      if (text.trimStart().startsWith('#EXTM3U')) {
        const baseUrl = upstream.url || targetUrl;
        const wrap = (raw) => {
          const abs = new URL(raw.trim(), baseUrl).href;
          const p = new URLSearchParams({ url: abs, referer });
          return `/api/edge-proxy?${p.toString()}`;
        };

        const rewritten = text
          .split(/\r?\n/)
          .map((line) => {
            const t = line.trim();
            if (!t) return line;
            if (t.startsWith('#')) {
              return line.replace(/URI="([^"]+)"/g, (_, u) => {
                try { return `URI="${wrap(u)}"`; } catch { return `URI="${u}"`; }
              });
            }
            try { return wrap(t); } catch { return line; }
          })
          .join('\n');

        resHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
        return new Response(rewritten, { status: upstream.status, headers: resHeaders });
      }
    }

    if (contentType) resHeaders.set('Content-Type', contentType);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) resHeaders.set('Content-Range', contentRange);

    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
}
