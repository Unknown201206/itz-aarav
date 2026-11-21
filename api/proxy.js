export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { url, cookie, referer, ua } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing  Url  Parameter" });
  }

  try {
    const headers = {
      "User-Agent": ua || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "*/*"
    };
    if (cookie) headers["Cookie"] = cookie;
    if (referer) {
      headers["Referer"] = referer;
      try { headers["Origin"] = new URL(referer).origin; } catch {}
    }
    if (req.headers.range) headers["Range"] = req.headers.range;

    const upstream = await fetch(url, {
      method: req.method,
      headers,
      redirect: "follow"
    });

    res.status(upstream.status);

    const contentType = upstream.headers.get("content-type") || "";
    const isM3u8 =
      contentType.toLowerCase().includes("mpegurl") ||
      url.toLowerCase().includes(".m3u8");

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
                try { return `URI="${buildProxyUrl(uri)}"`; } catch { return `URI="${uri}"`; }
              });
            }
            try { return buildProxyUrl(trimmed); } catch { return line; }
          })
          .join("\n");

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        return res.send(rewritten);
      }

      if (contentType) res.setHeader("Content-Type", contentType);
      return res.send(text);
    }

    if (contentType) res.setHeader("Content-Type", contentType);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (err) {
    return res.status(502).json({ error: "Proxy  Fetch  Failed", details: err.message });
  }
}
