// sub-agents/memory.js
// Per-user session memory + permanent knowledge base.
// Default storage: JSON files.
// Optional online storage: Supabase Postgres when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
// Important: invalid Supabase config must never crash the bot at startup.

const fs = require('fs').promises;
const path = require('path');

let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch {
  createClient = null;
}

const MEMORY_DIR = path.resolve(process.env.MEMORY_DIR || './agent-memory');
const MAX_MESSAGES = Number(process.env.MEMORY_MAX_MESSAGES || 50);
const MAX_KNOWLEDGE_ITEMS = Number(process.env.MEMORY_MAX_KNOWLEDGE_ITEMS || 500);
const SUPABASE_TABLE = process.env.SUPABASE_MEMORY_TABLE || 'martybot_memory';

let supabaseClient = null;
let supabaseDisabledReason = '';
let supabaseWarningPrinted = false;

function normalizeUrl(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function getSupabaseConfig() {
  const url = normalizeUrl(process.env.SUPABASE_URL);
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  const requested = String(process.env.MEMORY_BACKEND || '').toLowerCase() === 'supabase' || Boolean(url || key);
  return { url, key, requested };
}

function warnOnce(message) {
  if (supabaseWarningPrinted) return;
  supabaseWarningPrinted = true;
  console.warn(`[memory] ${message}`);
}

function getSupabaseClient() {
  if (supabaseDisabledReason) return null;

  const { url, key, requested } = getSupabaseConfig();
  if (!requested) return null;

  if (!url || !key) {
    supabaseDisabledReason = 'SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY chybí. Používám JSON paměť.';
    warnOnce(supabaseDisabledReason);
    return null;
  }

  if (!/^https?:\/\//i.test(url)) {
    supabaseDisabledReason = 'SUPABASE_URL je neplatná. Musí začínat https://...supabase.co. Používám JSON paměť.';
    warnOnce(supabaseDisabledReason);
    return null;
  }

  if (!createClient) {
    supabaseDisabledReason = '@supabase/supabase-js není nainstalovaný. Používám JSON paměť.';
    warnOnce(supabaseDisabledReason);
    return null;
  }

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    } catch (err) {
      supabaseDisabledReason = `Supabase client nejde vytvořit: ${err.message}. Používám JSON paměť.`;
      warnOnce(supabaseDisabledReason);
      return null;
    }
  }

  return supabaseClient;
}

function isSupabaseEnabled() {
  return Boolean(getSupabaseClient());
}

function memoryBackendStatus() {
  const { requested, url } = getSupabaseConfig();
  return {
    backend: isSupabaseEnabled() ? 'supabase' : 'json',
    requested,
    configuredUrl: Boolean(url),
    supabaseTable: SUPABASE_TABLE,
    disabledReason: supabaseDisabledReason,
  };
}

class Memory {
  constructor() {
    this.backend = isSupabaseEnabled() ? 'supabase' : 'json';
  }

  async _ensureDir() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  }

  _filePath(userId) {
    const safe = String(userId).replace(/[^a-zA-Z0-9_\-+]/g, '_');
    return path.join(MEMORY_DIR, `${safe}.json`);
  }

  _normalize(data, userId) {
    return {
      userId: data.userId || data.user_id || userId,
      messages: Array.isArray(data.messages) ? data.messages : [],
      knowledge: Array.isArray(data.knowledge) ? data.knowledge : [],
      createdAt: data.createdAt || data.created_at || new Date().toISOString(),
      updatedAt: data.updatedAt || data.updated_at,
    };
  }

  async _loadJson(userId) {
    try {
      const raw = await fs.readFile(this._filePath(userId), 'utf-8');
      return this._normalize(JSON.parse(raw), userId);
    } catch {
      return this._normalize({}, userId);
    }
  }

  async _saveJson(userId, data) {
    await this._ensureDir();
    const normalized = this._trim(this._normalize(data, userId));
    normalized.updatedAt = new Date().toISOString();
    await fs.writeFile(this._filePath(userId), JSON.stringify(normalized, null, 2), 'utf-8');
  }

  async _loadSupabase(userId) {
    const supabase = getSupabaseClient();
    if (!supabase) return this._loadJson(userId);

    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('user_id, data, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(`Supabase load failed: ${error.message}`);
    if (!data) return this._normalize({}, userId);

    return this._normalize({
      ...(data.data || {}),
      userId: data.user_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }, userId);
  }

  async _saveSupabase(userId, data) {
    const supabase = getSupabaseClient();
    if (!supabase) return this._saveJson(userId, data);

    const normalized = this._trim(this._normalize(data, userId));
    normalized.updatedAt = new Date().toISOString();

    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .upsert({
        user_id: userId,
        data: normalized,
        updated_at: normalized.updatedAt,
      }, { onConflict: 'user_id' });

    if (error) throw new Error(`Supabase save failed: ${error.message}`);
  }

  _trim(data) {
    const normalized = this._normalize(data, data.userId);

    if (normalized.messages.length > MAX_MESSAGES) {
      normalized.messages = normalized.messages.slice(-MAX_MESSAGES);
    }

    if (normalized.knowledge.length > MAX_KNOWLEDGE_ITEMS) {
      normalized.knowledge = normalized.knowledge.slice(-MAX_KNOWLEDGE_ITEMS);
    }

    return normalized;
  }

  async _load(userId) {
    if (isSupabaseEnabled()) return this._loadSupabase(userId);
    return this._loadJson(userId);
  }

  async _save(userId, data) {
    if (isSupabaseEnabled()) return this._saveSupabase(userId, data);
    return this._saveJson(userId, data);
  }

  async add(userId, role, content) {
    const data = await this._load(userId);
    data.messages.push({
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      ts: new Date().toISOString(),
    });
    await this._save(userId, data);
  }

  async getHistory(userId) {
    const data = await this._load(userId);
    return data.messages.map(({ role, content }) => ({ role, content }));
  }

  async clear(userId) {
    const data = await this._load(userId);
    data.messages = [];
    await this._save(userId, data);
  }

  async addKnowledge(userId, content, meta = {}) {
    const clean = String(content || '').trim();
    if (!clean) throw new Error('Knowledge content is empty.');

    const data = await this._load(userId);
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      content: clean.slice(0, Number(process.env.KNOWLEDGE_ITEM_MAX_CHARS || 12000)),
      source: meta.source || 'manual',
      title: meta.title || '',
      url: meta.url || '',
      createdAt: new Date().toISOString(),
    };

    data.knowledge.push(item);
    await this._save(userId, data);
    return item;
  }

  async removeKnowledge(userId, id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) throw new Error('Knowledge ID is empty.');

    const data = await this._load(userId);
    const before = data.knowledge.length;
    data.knowledge = data.knowledge.filter((item) => item.id !== cleanId);
    const removed = before - data.knowledge.length;
    await this._save(userId, data);
    return { removed, remaining: data.knowledge.length };
  }

  async listKnowledge(userId, limit = 20) {
    const data = await this._load(userId);
    return data.knowledge.slice(-limit).reverse();
  }

  async getKnowledgeContext(userId, maxChars = 10000) {
    const data = await this._load(userId);
    const items = data.knowledge
      .filter((item) => !['auto-worker', 'auto-improve', 'system-audit'].includes(item.source))
      .slice(-80)
      .reverse();
    let out = '';

    for (const item of items) {
      const label = item.title || item.source || item.id;
      const block = `- [${label}] ${item.content}\n`;
      if ((out + block).length > maxChars) break;
      out += block;
    }

    return out.trim();
  }

  async clearKnowledge(userId) {
    const data = await this._load(userId);
    data.knowledge = [];
    await this._save(userId, data);
  }

  async exportData(userId) {
    const data = await this._load(userId);
    return this._normalize(data, userId);
  }

  async exportJson(userId) {
    const data = await this.exportData(userId);
    return JSON.stringify({
      type: 'openclaw-memory-backup',
      version: 2,
      backend: isSupabaseEnabled() ? 'supabase' : 'json',
      exportedAt: new Date().toISOString(),
      data,
    }, null, 2);
  }

  async importJson(userId, jsonText, { merge = true } = {}) {
    let parsed;
    try {
      parsed = JSON.parse(String(jsonText || '').trim());
    } catch {
      throw new Error('Invalid JSON backup.');
    }

    const incoming = parsed.data ? parsed.data : parsed;
    const normalizedIncoming = this._normalize(incoming, userId);

    if (!merge) {
      await this._save(userId, normalizedIncoming);
      return normalizedIncoming;
    }

    const current = await this._load(userId);
    const merged = this._normalize({
      userId,
      messages: [...current.messages, ...normalizedIncoming.messages],
      knowledge: [...current.knowledge, ...normalizedIncoming.knowledge],
      createdAt: current.createdAt || normalizedIncoming.createdAt,
    }, userId);

    await this._save(userId, merged);
    return merged;
  }

  async stats(userId) {
    const data = await this._load(userId);
    const status = memoryBackendStatus();
    return {
      messages: data.messages.length,
      knowledge: data.knowledge.length,
      backend: status.backend,
      memoryDir: MEMORY_DIR,
      supabaseTable: SUPABASE_TABLE,
      supabaseRequested: status.requested,
      supabaseDisabledReason: status.disabledReason,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}

module.exports = Memory;
module.exports.memoryBackendStatus = memoryBackendStatus;
