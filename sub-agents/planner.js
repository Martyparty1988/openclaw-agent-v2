// sub-agents/planner.js
// Turns a task description into a structured execution plan using Claude.

const Anthropic = require('@anthropic-ai/sdk');

const PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-8b-instruct:free';

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
      // Fallback plan if JSON parse fails
      return {
        goal: task,
        agent: 'general',
        steps: [{ id: 1, action: 'Execute task', details: task, tool: 'bash' }],
      };
    }
  }

  async generatePlanText(task) {
    if (PROVIDER === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Create an execution plan for: ${task}` },
          ],
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter planner failed: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      return data?.choices?.[0]?.message?.content || '';
    }

    if (!client) {
      throw new Error('ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=openrouter for free models.');
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Create an execution plan for: ${task}` }],
    });

    return response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
}

module.exports = Planner;
