// sub-agents/executor.js
// Runs the agentic loop with tools: bash, file I/O, HTTP.
// Safety-first defaults: bash/write are disabled unless ALLOW_AGENT_* flags are true.

const { exec } = require('child_process');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const path = require('path');
const util = require('util');
const {
  getProvider,
  getModelForProvider,
  getChatCompletionsConfig,
  getAnthropicClient,
} = require('./model-presets');

const execAsync = util.promisify(exec);
const WORKDIR = path.resolve(process.env.AGENT_WORKDIR || process.cwd());

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function safePath(inputPath) {
  const resolved = path.resolve(WORKDIR, inputPath || '.');
  if (!resolved.startsWith(WORKDIR)) throw new Error('Path outside AGENT_WORKDIR is not allowed.');
  return resolved;
}

function validateUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http/https URLs are allowed.');

  const allowedHosts = (process.env.ALLOWED_FETCH_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (allowedHosts.length && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Host not allowed by ALLOWED_FETCH_HOSTS: ${parsed.hostname}`);
  }

  return parsed;
}

const TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command. Disabled by default unless ALLOW_AGENT_BASH=true.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'number' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from AGENT_WORKDIR.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content under AGENT_WORKDIR. Disabled unless ALLOW_AGENT_WRITE=true.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files under AGENT_WORKDIR.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'fetch_url',
    description: 'HTTP GET a URL. Optional ALLOWED_FETCH_HOSTS allowlist supported.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
];

async function runTool(name, input = {}) {
  try {
    switch (name) {
      case 'bash': {
        if (!envFlag('ALLOW_AGENT_BASH')) return { error: 'bash tool is disabled.' };
        const command = String(input.command || '').trim();
        if (!command) return { error: 'Empty command.' };
        const { stdout, stderr } = await execAsync(command, {
          timeout: Math.min(Number(input.timeout_ms || 15000), 30000),
          cwd: WORKDIR,
          maxBuffer: 1024 * 1024,
        });
        return { stdout: stdout.trim().slice(0, 4000), stderr: stderr.trim().slice(0, 4000) };
      }

      case 'read_file':
        return { content: await fs.readFile(safePath(input.path), 'utf-8') };

      case 'write_file': {
        if (!envFlag('ALLOW_AGENT_WRITE')) return { error: 'write_file tool is disabled.' };
        const filePath = safePath(input.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, input.content, 'utf-8');
        return { success: true, path: path.relative(WORKDIR, filePath) };
      }

      case 'list_dir': {
        const dir = safePath(input.path || '.');
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return { entries: entries.map((e) => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`) };
      }

      case 'fetch_url': {
        const parsed = validateUrl(input.url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const body = await new Promise((resolve, reject) => {
          const req = lib.get(parsed, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
              if (data.length > 12000) req.destroy(new Error('Response too large.'));
            });
            res.on('end', () => resolve(data));
          });
          req.on('timeout', () => req.destroy(new Error('Request timed out.')));
          req.on('error', reject);
        });
        return { body: String(body).slice(0, 4000) };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

const AGENT_SYSTEMS = {
  code: `You are CodeAgent. Odpovídej česky. Write clean, tested, production-ready code.`,
  data: `You are DataAgent. Odpovídej česky. Analyze data clearly with key numbers.`,
  deploy: `You are DeployAgent. Odpovídej česky. Be conservative and avoid destructive operations.`,
  general: `Odpovídej vždy česky, pokud uživatel výslovně nechce jiný jazyk. Jsi praktický AI asistent.`,
};

class Executor {
  async run(userId, planOrTask, onProgress, maxIter = 12) {
    const provider = getProvider();
    if (provider === 'openrouter' || provider === 'deepseek' || provider === 'openai') {
      return this.runTextOnlyProvider(provider, planOrTask, getChatCompletionsConfig(provider));
    }

    const client = getAnthropicClient();
    if (!client) throw new Error('ANTHROPIC_API_KEY is missing.');

    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map((s) => `${s.id}. [${s.tool}] ${s.action}: ${s.details}`).join('\n')}`;

    const agentKey = typeof planOrTask === 'object' ? (planOrTask.agent || 'general') : 'general';
    const system = AGENT_SYSTEMS[agentKey] || AGENT_SYSTEMS.general;
    const messages = [{ role: 'user', content: task }];

    for (let i = 0; i < maxIter; i++) {
      const res = await client.messages.create({ model: getModelForProvider('anthropic'), max_tokens: 4096, system, tools: TOOLS, messages });
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason === 'end_turn') {
        const output = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        return { output, iterations: i + 1 };
      }

      const calls = res.content.filter((b) => b.type === 'tool_use');
      if (!calls.length) break;

      const results = [];
      for (const call of calls) {
        if (onProgress) onProgress(`🔧 ${call.name}(${JSON.stringify(call.input).slice(0, 80)})`);
        const result = await runTool(call.name, call.input);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: results });
    }

    return { output: 'Agent reached max iterations.', iterations: maxIter };
  }

  async chat(userId, message, history = []) {
    const provider = getProvider();
    const messages = [...history, { role: 'user', content: message }];

    if (provider === 'openrouter' || provider === 'deepseek' || provider === 'openai') {
      return this.chatCompletions(getChatCompletionsConfig(provider), messages);
    }

    const client = getAnthropicClient();
    if (!client) throw new Error('ANTHROPIC_API_KEY is missing.');

    const res = await client.messages.create({
      model: getModelForProvider('anthropic'),
      max_tokens: 1024,
      system: AGENT_SYSTEMS.general,
      messages,
    });
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }

  async runTextOnlyProvider(providerName, planOrTask, config) {
    if (!config) throw new Error(`Unsupported provider: ${providerName}`);
    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map((s) => `${s.id}. ${s.action}: ${s.details}`).join('\n')}`;

    const output = await this.chatCompletions(config, [
      { role: 'system', content: `Odpovídej česky. Běžíš v ${providerName} text-only režimu. Nemůžeš přímo spouštět bash ani měnit soubory. Dej přesný plán nebo patch text.` },
      { role: 'user', content: task },
    ]);

    return { output, iterations: 1 };
  }

  async chatCompletions(config, messages) {
    if (!config.token) throw new Error(`${config.tokenLabel} is missing.`);

    const headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    };

    if (config.providerName === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/Martyparty1988/openclaw-agent-v2';
      headers['X-Title'] = 'OpenClaw Agent';
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, messages }),
    });

    if (!response.ok) throw new Error(`${config.providerName} executor failed: ${response.status} ${await response.text()}`);

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || 'Žádná odpověď od modelu.';
  }
}

module.exports = Executor;
