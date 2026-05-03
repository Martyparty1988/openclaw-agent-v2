// sub-agents/executor.js
const OpenAI = require('openai');
const { exec } = require('child_process');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

const TOOLS = [
  { type: 'function', function: { name: 'bash', description: 'Execute a shell command. Returns stdout and stderr.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a file from disk.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write content to a file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'List files in a directory.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'fetch_url', description: 'HTTP GET a URL.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
];

async function runTool(name, input) { try { switch (name) { case 'bash': { const { stdout, stderr } = await execAsync(input.command, { timeout: input.timeout_ms || 15000, cwd: process.env.AGENT_WORKDIR || process.cwd() }); return { stdout: stdout.trim(), stderr: stderr.trim() }; } case 'read_file': return { content: await fs.readFile(input.path, 'utf-8') }; case 'write_file': await fs.mkdir(path.dirname(path.resolve(input.path)), { recursive: true }); await fs.writeFile(input.path, input.content, 'utf-8'); return { success: true, path: input.path }; case 'list_dir': { const dir = input.path || '.'; const entries = await fs.readdir(dir, { withFileTypes: true }); return { entries: entries.map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`) }; } case 'fetch_url': { const lib = input.url.startsWith('https') ? https : http; const body = await new Promise((resolve, reject) => { lib.get(input.url, (res) => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve(d)); }).on('error', reject); }); return { body: body.slice(0, 4000) }; } default: return { error: `Unknown tool: ${name}` }; } } catch (err) { return { error: err.message }; } }

const AGENT_SYSTEMS = { code: 'You are CodeAgent, an expert software engineer.', data: 'You are DataAgent, an expert data analyst.', deploy: 'You are DeployAgent, a DevOps expert.', general: 'You are a capable AI assistant with access to real tools.' };

class Executor {
  async run(userId, planOrTask, onProgress, maxIter = 8) {
    const task = typeof planOrTask === 'string' ? planOrTask : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map(s => `${s.id}. [${s.tool}] ${s.action}: ${s.details}`).join('\n')}`;
    const agentKey = typeof planOrTask === 'object' ? (planOrTask.agent || 'general') : 'general';
    const system = AGENT_SYSTEMS[agentKey] || AGENT_SYSTEMS.general;
    const messages = [{ role: 'system', content: system }, { role: 'user', content: task }];

    for (let i = 0; i < maxIter; i++) {
      const res = await client.chat.completions.create({ model: MODEL, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2 });
      const msg = res.choices?.[0]?.message;
      messages.push(msg);
      const calls = msg.tool_calls || [];
      if (!calls.length) return { output: msg.content || 'Hotovo.', iterations: i + 1 };
      for (const call of calls) {
        const input = JSON.parse(call.function.arguments || '{}');
        if (onProgress) onProgress(`🔧 ${call.function.name}(${JSON.stringify(input).slice(0, 60)})`);
        const result = await runTool(call.function.name, input);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return { output: 'Agent reached max iterations.', iterations: maxIter };
  }

  async chat(userId, message, history = []) {
    const messages = [...history, { role: 'user', content: message }];
    const res = await client.chat.completions.create({ model: MODEL, messages: [{ role: 'system', content: AGENT_SYSTEMS.general }, ...messages], temperature: 0.4 });
    return res.choices?.[0]?.message?.content || '';
  }
}

module.exports = Executor;
