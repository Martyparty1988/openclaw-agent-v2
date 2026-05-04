// sub-agents/executor.js
// Runs the agentic loop with tools: bash, file I/O, HTTP.
// Safety-first defaults: bash is disabled unless ALLOW_AGENT_BASH=true.

const Anthropic = require('@anthropic-ai/sdk');
const { exec } = require('child_process');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const WORKDIR = path.resolve(process.env.AGENT_WORKDIR || process.cwd());

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function safePath(inputPath) {
  const resolved = path.resolve(WORKDIR, inputPath || '.');
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error('Path outside AGENT_WORKDIR is not allowed.');
  }
  return resolved;
}

function validateUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed.');
  }

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
        command: { type: 'string', description: 'Shell command to run' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 15000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from AGENT_WORKDIR. Returns its content.',
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
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files under AGENT_WORKDIR.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path (default: .)' } },
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
        if (!envFlag('ALLOW_AGENT_BASH')) {
          return { error: 'bash tool is disabled. Set ALLOW_AGENT_BASH=true only for trusted private deployments.' };
        }
        const command = String(input.command || '').trim();
        if (!command) return { error: 'Empty command.' };
        const { stdout, stderr } = await execAsync(command, {
          timeout: Math.min(Number(input.timeout_ms || 15000), 30000),
          cwd: WORKDIR,
          maxBuffer: 1024 * 1024,
        });
        return { stdout: stdout.trim().slice(0, 4000), stderr: stderr.trim().slice(0, 4000) };
      }

      case 'read_file': {
        const filePath = safePath(input.path);
        return { content: await fs.readFile(filePath, 'utf-8') };
      }

      case 'write_file': {
        if (!envFlag('ALLOW_AGENT_WRITE')) {
          return { error: 'write_file tool is disabled. Set ALLOW_AGENT_WRITE=true only for trusted private deployments.' };
        }
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
  code: `You are CodeAgent, an expert software engineer. Write clean, tested, production-ready code.
Read files before modifying. Run tests after changes. Explain every significant change.`,
  data: `You are DataAgent, an expert data analyst. Analyze files, compute statistics, identify patterns.
Present findings clearly with key numbers. Use tools carefully when needed.`,
  deploy: `You are DeployAgent, a DevOps expert. Handle git, deployments, servers, backups.
Check current state before changes. Be conservative and avoid destructive operations.`,
  general: `You are a capable AI assistant with access to guarded tools.
If a tool is disabled, explain which environment flag is needed and why it should only be enabled for trusted private deployments.
If information is missing, ask a brief clarifying question or explain what is needed.
Summarize what you did at the end.`,
};

class Executor {
  async run(userId, planOrTask, onProgress, maxIter = 12) {
    if (PROVIDER === 'openrouter') return this.runOpenRouter(planOrTask);
    if (PROVIDER === 'openai') return this.runOpenAI(planOrTask);

    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=openrouter/openai for text-only mode.');
    }

    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map((s) => `${s.id}. [${s.tool}] ${s.action}: ${s.details}`).join('\n')}`;

    const agentKey = typeof planOrTask === 'object' ? (planOrTask.agent || 'general') : 'general';
    const system = AGENT_SYSTEMS[agentKey] || AGENT_SYSTEMS.general;
    const messages = [{ role: 'user', content: task }];

    for (let i = 0; i < maxIter; i++) {
      const res = await client.messages.create({ model: MODEL, max_tokens: 4096, system, tools: TOOLS, messages });
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
    const messages = [...history, { role: 'user', content: message }];

    if (PROVIDER === 'openrouter') {
      return this.chatCompletions({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        token: process.env.OPENROUTER_API_KEY,
        tokenLabel: 'OPENROUTER_API_KEY',
        model: OPENROUTER_MODEL,
      }, messages);
    }

    if (PROVIDER === 'openai') {
      return this.chatCompletions({
        url: 'https://api.openai.com/v1/chat/completions',
        token: process.env.OPENAI_API_KEY,
        tokenLabel: 'OPENAI_API_KEY',
        model: OPENAI_MODEL,
      }, messages);
    }

    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=openrouter/openai for text-only mode.');
    }

    const res = await client.messages.create({ model: MODEL, max_tokens: 1024, system: AGENT_SYSTEMS.general, messages });
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }

  async runOpenRouter(planOrTask) {
    return this.runTextOnlyProvider('openrouter', planOrTask, {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      token: process.env.OPENROUTER_API_KEY,
      tokenLabel: 'OPENROUTER_API_KEY',
      model: OPENROUTER_MODEL,
    });
  }

  async runOpenAI(planOrTask) {
    return this.runTextOnlyProvider('openai', planOrTask, {
      url: 'https://api.openai.com/v1/chat/completions',
      token: process.env.OPENAI_API_KEY,
      tokenLabel: 'OPENAI_API_KEY',
      model: OPENAI_MODEL,
    });
  }

  async runTextOnlyProvider(providerName, planOrTask, config) {
    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map((s) => `${s.id}. ${s.action}: ${s.details}`).join('\n')}`;

    const output = await this.chatCompletions(config, [
      { role: 'system', content: `You are running in ${providerName} text-only mode. You cannot execute bash or modify files directly. Provide a precise plan or patch text instead.` },
      { role: 'user', content: task },
    ]);

    return { output, iterations: 1 };
  }

  async chatCompletions(config, messages) {
    if (!config.token) throw new Error(`${config.tokenLabel} is missing.`);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Martyparty1988/openclaw-agent-v2',
        'X-Title': 'OpenClaw Agent',
      },
      body: JSON.stringify({ model: config.model, messages }),
    });

    if (!response.ok) {
      throw new Error(`${PROVIDER} executor failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || 'Žádná odpověď od modelu.';
  }
}

module.exports = Executor;
