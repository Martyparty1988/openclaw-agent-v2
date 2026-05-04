// sub-agents/memory.js
// Per-user session memory + permanent knowledge base.
// Stored as JSON files. For Railway production, set MEMORY_DIR to a mounted Volume path.

const fs = require('fs').promises;
const path = require('path');

const MEMORY_DIR = path.resolve(process.env.MEMORY_DIR || './agent-memory');
const MAX_MESSAGES = Number(process.env.MEMORY_MAX_MESSAGES || 50);
const MAX_KNOWLEDGE_ITEMS = Number(process.env.MEMORY_MAX_KNOWLEDGE_ITEMS || 500);

class Memory {
  async _ensureDir() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  }

  _filePath(userId) {
    const safe = String(userId).replace(/[^a-zA-Z0-9_\-+]/g, '_');
    return path.join(MEMORY_DIR, `${safe}.json`);
  }

  _normalize(data, userId) {
    return {
      userId: data.userId || userId,
      messages: Array.isArray(data.messages) ? data.messages : [],
      knowledge: Array.isArray(data.knowledge) ? data.knowledge : [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt,
    };
  }

  async _load(userId) {
    try {
      const raw = await fs.readFile(this._filePath(userId), 'utf-8');
      return this._normalize(JSON.parse(raw), userId);
    } catch {
      return this._normalize({}, userId);
    }
  }

  async _save(userId, data) {
    await this._ensureDir();
    const normalized = this._normalize(data, userId);

    if (normalized.messages.length > MAX_MESSAGES) {
      normalized.messages = normalized.messages.slice(-MAX_MESSAGES);
    }

    if (normalized.knowledge.length > MAX_KNOWLEDGE_ITEMS) {
      normalized.knowledge = normalized.knowledge.slice(-MAX_KNOWLEDGE_ITEMS);
    }

    normalized.updatedAt = new Date().toISOString();
    await fs.writeFile(this._filePath(userId), JSON.stringify(normalized, null, 2), 'utf-8');
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

  async listKnowledge(userId, limit = 20) {
    const data = await this._load(userId);
    return data.knowledge.slice(-limit).reverse();
  }

  async getKnowledgeContext(userId, maxChars = 10000) {
    const data = await this._load(userId);
    const items = data.knowledge.slice(-80).reverse();
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
      version: 1,
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
    return {
      messages: data.messages.length,
      knowledge: data.knowledge.length,
      memoryDir: MEMORY_DIR,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}

module.exports = Memory;
