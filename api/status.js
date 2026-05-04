// api/status.js — Vercel proxy to Railway Martybot backend.
// Required Vercel env: AGENT_BACKEND_URL
// Optional Vercel env: WEB_API_TOKEN, passed to Railway as Bearer token.

function backendUrl(path) {
  const base = process.env.AGENT_BACKEND_URL;
  if (!base) throw new Error('AGENT_BACKEND_URL is missing in Vercel environment variables.');
  return `${base.replace(/\/$/, '')}${path}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const headers = {};
    if (process.env.WEB_API_TOKEN) headers.Authorization = `Bearer ${process.env.WEB_API_TOKEN}`;

    const response = await fetch(backendUrl('/api/status'), { headers });
    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
