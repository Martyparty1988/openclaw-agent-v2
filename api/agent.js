const { DeveloperAgent } = require('../lib/developer-agent');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').trim();
    const context = String(body.context || 'default');
    const sessionId = body.sessionId ? String(body.sessionId) : null;

    if (!message) return res.status(400).json({ ok: false, error: 'Missing message.' });

    const agent = new DeveloperAgent();
    const memory = await agent.getMemory(context);

    const response = {
      reply: `Rozumím. Zpráva byla přijata v kontextu "${context}".`,
      previousMemory: memory,
    };

    await agent.saveMemory(context, { message, response }, sessionId);
    return res.status(200).json({ ok: true, response });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
