const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

class QaAgent {
  async run() {
    const commands = [
      'node --check meta-agent.js',
      'node --check sub-agents/executor.js',
      'node --check sub-agents/planner.js',
      'node --check sub-agents/self-improve.js',
      'node --check server.js',
    ];

    const results = [];
    for (const command of commands) {
      try {
        await execAsync(command);
        results.push({ command, ok: true });
      } catch (error) {
        results.push({ command, ok: false, error: (error.stderr || error.message || '').trim() });
      }
    }

    const failed = results.filter((item) => !item.ok);
    return {
      ok: failed.length === 0,
      summary: `${results.length - failed.length}/${results.length} checks passed`,
      results,
    };
  }
}

module.exports = QaAgent;
