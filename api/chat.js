// api/chat.js — Vercel proxy to Railway Martybot backend.
// Required Vercel env: AGENT_BACKEND_URL
// Optional Vercel env: WEB_API_TOKEN, passed to Railway as Bearer token.

function backendUrl(path) {
  const base = process.env.AGENT_BACKEND_URL;
  if (!base) throw new Error('AGENT_BACKEND_URL is missing in Vercel environment variables.');
  return `${base.replace(/\/$/, '')}${path}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const text = String(body.text || body.message || '').trim();
    const userId = String(body.userId || 'web_user');

    if (!text) return res.status(400).json({ ok: false, error: 'Missing text.' });

    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WEB_API_TOKEN) headers.Authorization = `Bearer ${process.env.WEB_API_TOKEN}`;

    const response = await fetch(backendUrl('/api/chat'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, userId }),
    });

    const data = await response.json().catch(async () => ({ ok: false, error: await response.text() }));
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
