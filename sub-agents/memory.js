// sub-agents/memory.js
// Per-user session memory. Stored as JSON files, persists across restarts.

const fs = require('fs').promises;
const path = require('path');

const MEMORY_DIR = path.resolve(process.env.MEMORY_DIR || './agent-memory');
const MAX_MESSAGES = 50;

class Memory {
  async _ensureDir() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  }

  _filePath(userId) {
    const safe = String(userId).replace(/[^a-zA-Z0-9_\-+]/g, '_');
    return path.join(MEMORY_DIR, `${safe}.json`);
  }

  async _load(userId) {
    try {
      const raw = await fs.readFile(this._filePath(userId), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { userId, messages: [], createdAt: new Date().toISOString() };
    }
  }

  async _save(userId, data) {
    await this._ensureDir();
    if (data.messages.length > MAX_MESSAGES) {
      // Keep system context fresh: drop oldest but keep last MAX_MESSAGES
      data.messages = data.messages.slice(-MAX_MESSAGES);
    }
    data.updatedAt = new Date().toISOString();
    await fs.writeFile(this._filePath(userId), JSON.stringify(data, null, 2), 'utf-8');
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
    // Return Claude API format (no timestamps)
    return data.messages.map(({ role, content }) => ({ role, content }));
  }

  async clear(userId) {
    const data = await this._load(userId);
    data.messages = [];
    await this._save(userId, data);
  }

  async stats(userId) {
    const data = await this._load(userId);
    return {
      messages: data.messages.length,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}

module.exports = Memory;
