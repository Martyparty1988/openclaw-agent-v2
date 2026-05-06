const { createClient } = require('@supabase/supabase-js');

class DeveloperAgent {
  constructor() {
    this.config = {
      role: process.env.AGENT_ROLE || 'Vývojářský asistent',
      language: process.env.AGENT_LANGUAGE || 'czech',
      specializations: [
        'Railway deployment',
        'Vercel hosting',
        'GitHub workflows',
        'Supabase databáze',
        'Next.js aplikace',
      ],
      memory: String(process.env.PERSISTENT_MEMORY || 'enabled').toLowerCase() === 'enabled',
    };

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    this.supabase = url && key ? createClient(url, key) : null;
  }

  async saveMemory(context, data, sessionId = null) {
    if (!this.supabase || !this.config.memory) return { skipped: true };
    return this.supabase.from('agent_memory').insert({
      session_id: sessionId,
      context,
      data,
    });
  }

  async getMemory(context) {
    if (!this.supabase || !this.config.memory) return null;
    const { data, error } = await this.supabase
      .from('agent_memory')
      .select('data')
      .eq('context', context)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) return null;
    return data?.[0]?.data ?? null;
  }
}

module.exports = { DeveloperAgent };
