// sub-agents/executor.js
// Runs the agentic loop with real tools: bash, file I/O, HTTP.

const Anthropic = require('@anthropic-ai/sdk');
const { exec } = require('child_process');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-8b-instruct:free';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command. Returns stdout and stderr.',
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
    description: 'Read a file from disk. Returns its content.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file (creates directories as needed).',
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
    description: 'List files in a directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path (default: .)' } },
      required: [],
    },
  },
  {
    name: 'fetch_url',
    description: 'HTTP GET a URL. Returns first 4000 chars of body.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
];

async function runTool(name, input) {
  try {
    switch (name) {
      case 'bash': {
        const { stdout, stderr } = await execAsync(input.command, {
          timeout: input.timeout_ms || 15000,
          cwd: process.env.AGENT_WORKDIR || process.cwd(),
        });
        return { stdout: stdout.trim(), stderr: stderr.trim() };
      }
      case 'read_file':
        return { content: await fs.readFile(input.path, 'utf-8') };
      case 'write_file':
        await fs.mkdir(path.dirname(path.resolve(input.path)), { recursive: true });
        await fs.writeFile(input.path, input.content, 'utf-8');
        return { success: true, path: input.path };
      case 'list_dir': {
        const dir = input.path || '.';
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return {
          entries: entries.map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`),
        };
      }
      case 'fetch_url': {
        const lib = input.url.startsWith('https') ? https : http;
        const body = await new Promise((resolve, reject) => {
          lib.get(input.url, (res) => {
            let d = '';
            res.on('data', c => (d += c));
            res.on('end', () => resolve(d));
          }).on('error', reject);
        });
        return { body: body.slice(0, 4000) };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

const AGENT_SYSTEMS = {
  code: `You are CodeAgent, an expert software engineer. Write clean, tested, production-ready code.
Read files before modifying. Run tests after changes. Explain every significant change.`,
  data: `You are DataAgent, an expert data analyst. Analyze files, compute statistics, identify patterns.
Present findings clearly with key numbers. Use bash for Python/Node analysis scripts when needed.`,
  deploy: `You are DeployAgent, a DevOps expert. Handle git, deployments, servers, backups.
Check current state before changes. Be conservative — confirm before destructive operations.`,
  general: `You are a capable AI assistant with access to real tools.
Never claim you can only answer from a specific knowledge base unless the user explicitly asks for KB-only mode.
If information is missing, ask a brief clarifying question or explain what is needed.
Think step by step. Use tools to get things done. Summarize what you did at the end.`,
};

class Executor {
  async run(userId, planOrTask, onProgress, maxIter = 12) {
    if (PROVIDER === 'openrouter') {
      return this.runOpenRouter(planOrTask);
    }
    if (PROVIDER === 'openai') {
      return this.runOpenAI(planOrTask);
    }

    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=openrouter for free models.');
    }

    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map(s => `${s.id}. [${s.tool}] ${s.action}: ${s.details}`).join('\n')}`;

    const agentKey = typeof planOrTask === 'object' ? (planOrTask.agent || 'general') : 'general';
    const system = AGENT_SYSTEMS[agentKey] || AGENT_SYSTEMS.general;

    const messages = [{ role: 'user', content: task }];

    for (let i = 0; i < maxIter; i++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools: TOOLS,
        messages,
      });

      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason === 'end_turn') {
        const output = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        return { output, iterations: i + 1 };
      }

      const calls = res.content.filter(b => b.type === 'tool_use');
      if (!calls.length) break;

      const results = [];
      for (const call of calls) {
        if (onProgress) onProgress(`🔧 ${call.name}(\`${JSON.stringify(call.input).slice(0, 60)}\`)`);
        const result = await runTool(call.name, call.input);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      }

      messages.push({ role: 'user', content: results });
    }

    return { output: 'Agent reached max iterations.', iterations: maxIter };
  }

  async chat(userId, message, history = []) {
    if (PROVIDER === 'openrouter') {
      const orMessages = [
        ...history,
        { role: 'user', content: message },
      ];
      const output = await this.chatCompletions({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        token: process.env.OPENROUTER_API_KEY,
        tokenLabel: 'OPENROUTER_API_KEY',
        model: OPENROUTER_MODEL,
      }, orMessages);
      return output;
    }

    if (PROVIDER === 'openai') {
      const aiMessages = [
        ...history,
        { role: 'user', content: message },
      ];
      const output = await this.chatCompletions({
        url: 'https://api.openai.com/v1/chat/completions',
        token: process.env.OPENAI_API_KEY,
        tokenLabel: 'OPENAI_API_KEY',
        model: OPENAI_MODEL,
      }, aiMessages);
      return output;
    }

    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=openrouter for free models.');
    }

    const messages = [
      ...history,
      { role: 'user', content: message },
    ];

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: AGENT_SYSTEMS.general,
      messages,
    });

    return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  }

  async runOpenRouter(planOrTask) {
    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map(s => `${s.id}. ${s.action}: ${s.details}`).join('\n')}`;
    const output = await this.chatCompletions({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      token: process.env.OPENROUTER_API_KEY,
      tokenLabel: 'OPENROUTER_API_KEY',
      model: OPENROUTER_MODEL,
    }, [{ role: 'user', content: task }]);
    return { output, iterations: 1 };
  }

  async runOpenAI(planOrTask) {
    const task = typeof planOrTask === 'string'
      ? planOrTask
      : `Goal: ${planOrTask.goal}\n\nSteps:\n${planOrTask.steps.map(s => `${s.id}. ${s.action}: ${s.details}`).join('\n')}`;
    const output = await this.chatCompletions({
      url: 'https://api.openai.com/v1/chat/completions',
      token: process.env.OPENAI_API_KEY,
      tokenLabel: 'OPENAI_API_KEY',
      model: OPENAI_MODEL,
    }, [{ role: 'user', content: task }]);
    return { output, iterations: 1 };
  }

  async chatCompletions(config, messages) {
    if (!config.token) {
      throw new Error(`${config.tokenLabel} is missing.`);
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`${PROVIDER} executor failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || 'Žádná odpověď od modelu.';
  }
}

module.exports = Executor;
