// sub-agents/planner.js
// Turns a task description into a structured execution plan using the selected LLM provider.

const Anthropic = require('@anthropic-ai/sdk');

const PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM = `You are a Planner agent. Your only job is to decompose tasks into clear, executable steps.
Always return valid JSON only — no markdown, no explanation outside the JSON.
Format: { "goal": "string", "agent": "code|data|deploy|general", "steps": [{ "id": 1, "action": "string", "details": "string", "tool": "bash|read_file|write_file|fetch_url|none" }] }
Be specific — each step should map to a concrete tool call or action.`;

class Planner {
  async create(userId, task) {
    const text = await this.generatePlanText(task);

    try {
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return {
        goal: task,
        agent: 'general',
        steps: [{ id: 1, action: 'Respond with a safe text answer', details: task, tool: 'none' }],
      };
    }
  }

  async generatePlanText(task) {
    if (PROVIDER === 'openrouter') {
      return this.generateChatCompletionsText({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        token: process.env.OPENROUTER_API_KEY,
        tokenLabel: 'OPENROUTER_API_KEY',
        model: OPENROUTER_MODEL,
      }, task);
    }

    if (PROVIDER === 'openai') {
      return this.generateChatCompletionsText({
        url: 'https://api.openai.com/v1/chat/completions',
        token: process.env.OPENAI_API_KEY,
        tokenLabel: 'OPENAI_API_KEY',
        model: OPENAI_MODEL,
      }, task);
    }

    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. For the free mode set LLM_PROVIDER=openrouter and OPENROUTER_MODEL=openrouter/free.');
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Create an execution plan for: ${task}` }],
    });

    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  async generateChatCompletionsText(config, task) {
    if (!config.token) throw new Error(`${config.tokenLabel} is missing.`);

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Martyparty1988/openclaw-agent-v2',
        'X-Title': 'OpenClaw Agent',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Create an execution plan for: ${task}` },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`${PROVIDER} planner failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }
}

module.exports = Planner;
