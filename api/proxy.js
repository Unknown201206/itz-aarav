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
    const headers = {};
    if (cookie) headers["Cookie"] = cookie;
    if (referer) {
      headers["Referer"] = referer;
      try { headers["Origin"] = new URL(referer).origin; } catch {}
    }
    if (ua) headers["User-Agent"] = ua;
    if (req.headers.range) headers["Range"] = req.headers.range;

    const upstream = await fetch(url, {
      method: req.method,
      headers,
      redirect: "follow"
    });

    res.status(upstream.status);

    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (err) {
    return res.status(502).json({ error: "Proxy  Fetch  Failed", details: err.message });
  }
}
