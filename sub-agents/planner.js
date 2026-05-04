// sub-agents/planner.js
// Turns a task description into a structured execution plan using the selected runtime LLM provider.

const {
  getProvider,
  getModelForProvider,
  getChatCompletionsConfig,
  getAnthropicClient,
} = require('./model-presets');

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
    const provider = getProvider();

    if (provider === 'openrouter' || provider === 'deepseek' || provider === 'openai') {
      return this.generateChatCompletionsText(getChatCompletionsConfig(provider), task);
    }

    const client = getAnthropicClient();
    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. For free mode set LLM_PROVIDER=openrouter and OPENROUTER_MODEL=openrouter/free.');
    }

    const response = await client.messages.create({
      model: getModelForProvider('anthropic'),
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Create an execution plan for: ${task}` }],
    });

    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  async generateChatCompletionsText(config, task) {
    if (!config) throw new Error('Unsupported provider.');
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
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Create an execution plan for: ${task}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`${config.providerName} planner failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }
}

module.exports = Planner;
