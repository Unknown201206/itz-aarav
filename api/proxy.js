export const config = { runtime: "edge" };

//   Add  Any  Other  Domain  You  Own  To  This  List
const ALLOWED_ORIGINS = [
  "https://itz-aarav.vercel.app"
];

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  const reqReferer = req.headers.get("referer") || "";
  const secFetchSite = req.headers.get("sec-fetch-site") || "";

  const isSameOrigin = secFetchSite === "same-origin";
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
  const isAllowedReferer = ALLOWED_ORIGINS.some((allowed) => reqReferer.startsWith(allowed));

  const corsOrigin = isAllowedOrigin ? origin : ALLOWED_ORIGINS[0];
  const baseCorsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Vary": "Origin"
  };

  if (req.method === "OPTIONS") {
    if (!isSameOrigin && !isAllowedOrigin && !isAllowedReferer) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: baseCorsHeaders });
  }

  //   Block  External  Websites  &  Unauthorized  scrapers  To  Protect  Your  10 GB  Quota
  if (!isSameOrigin && !isAllowedOrigin && !isAllowedReferer) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const cookie = searchParams.get("cookie") || "";
  const referer = searchParams.get("referer") || "";
  const ua = searchParams.get("ua") || "";

  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response(JSON.stringify({ error: "Missing  or  Invalid  URL  Parameter" }), {
      status: 400,
      headers: { ...baseCorsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const headers = new Headers({
      "User-Agent":
        ua ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "*/*"
    });

    if (cookie) headers.set("Cookie", cookie);
    if (referer) {
      headers.set("Referer", referer);
      try {
        headers.set("Origin", new URL(referer).origin);
      } catch {}
    }

    const range = req.headers.get("range");
    if (range) headers.set("Range", range);

    const upstream = await fetch(url, {
      method: req.method,
      headers,
      redirect: "follow"
    });

    const contentType = upstream.headers.get("content-type") || "";
    const lowerCt = contentType.toLowerCase();
    const lowerUrl = url.toLowerCase();
    const isM3u8 = lowerCt.includes("mpegurl") || lowerUrl.includes(".m3u8");
    const isMpd = lowerCt.includes("dash+xml") || lowerUrl.includes(".mpd");

    const resHeaders = new Headers(baseCorsHeaders);

    //   Inject  <BaseURL>  Into  DASH  .mpd  Manifests  So  Relative  Segments  Resolve  Against  The  Real  CDN
    if (upstream.ok && isMpd) {
      let xml = await upstream.text();
      if (xml.includes("<MPD") && !/<BaseURL>\s*https?:\/\//i.test(xml)) {
        const finalUpstream = upstream.url || url;
        const baseDir = finalUpstream.substring(0, finalUpstream.lastIndexOf("/") + 1).replace(/&/g, "&amp;");
        xml = xml.replace(/(<MPD\b[^>]*>)/i, `$1<BaseURL>${baseDir}</BaseURL>`);
      }
      resHeaders.set("Content-Type", contentType || "application/dash+xml");
      return new Response(xml, { status: upstream.status, headers: resHeaders });
    }

    //   Rewrite  HLS  Playlists  So  Sub - Manifests  &  .ts  Chunks  Also  Stay  Proxied
    if (upstream.ok && isM3u8) {
      const text = await upstream.text();
      if (text.trimStart().startsWith("#EXTM3U")) {
        const baseUrl = upstream.url || url;
        const buildProxyUrl = (rawTarget) => {
          const abs = new URL(rawTarget.trim(), baseUrl).href;
          const p = new URLSearchParams({ url: abs });
          if (cookie) p.set("cookie", cookie);
          if (referer) p.set("referer", referer);
          if (ua) p.set("ua", ua);
          return `/api/proxy?${p.toString()}`;
        };

        const rewritten = text
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith("#")) {
              return line.replace(/URI="([^"]+)"/g, (_, uri) => {
                try {
                  return `URI="${buildProxyUrl(uri)}"`;
                } catch {
                  return `URI="${uri}"`;
                }
              });
            }
            try {
              return buildProxyUrl(trimmed);
            } catch {
              return line;
            }
          })
          .join("\n");

        resHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        return new Response(rewritten, { status: upstream.status, headers: resHeaders });
      }

      if (contentType) resHeaders.set("Content-Type", contentType);
      return new Response(text, { status: upstream.status, headers: resHeaders });
    }

    //   Stream  Video  Chunks  Directly   (  Zero  RAM  Buffering  )
    if (contentType) resHeaders.set("Content-Type", contentType);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) resHeaders.set("Content-Range", contentRange);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) resHeaders.set("Content-Length", contentLength);
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) resHeaders.set("Accept-Ranges", acceptRanges);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Proxy Fetch Failed", details: err.message }),
      {
        status: 502,
        headers: { ...baseCorsHeaders, "Content-Type": "application/json" }
      }
    );
  }
}
