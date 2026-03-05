const fs = require('fs').promises;
const path = require('path');

const TASKS_FILE = path.resolve(process.env.TASKS_FILE || './agent-memory/tasks.json');

class TaskManager {
  async _load() {
    try {
      const raw = await fs.readFile(TASKS_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async _save(data) {
    await fs.mkdir(path.dirname(TASKS_FILE), { recursive: true });
    await fs.writeFile(TASKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  async add(userId, title) {
    const data = await this._load();
    const tasks = data[userId] || [];
    const item = {
      id: Date.now(),
      title,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    tasks.push(item);
    data[userId] = tasks;
    await this._save(data);
    return item;
  }

  async completeAll(userId) {
    const data = await this._load();
    const tasks = data[userId] || [];
    const now = new Date().toISOString();
    const updated = tasks.map((task) => ({ ...task, status: 'done', doneAt: now }));
    data[userId] = updated;
    await this._save(data);
    return updated.length;
  }

  async list(userId) {
    const data = await this._load();
    return data[userId] || [];
  }
}

module.exports = TaskManager;
