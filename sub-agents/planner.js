// sub-agents/planner.js
// Turns a task description into a structured execution plan using OpenAI.

const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

const SYSTEM = `You are a Planner agent. Your only job is to decompose tasks into clear, executable steps.
Always return valid JSON only — no markdown, no explanation outside the JSON.
Format: { "goal": "string", "agent": "code|data|deploy|general", "steps": [{ "id": 1, "action": "string", "details": "string", "tool": "bash|read_file|write_file|fetch_url|none" }] }
Be specific — each step should map to a concrete tool call or action.`;

class Planner {
  async create(userId, task) {
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Create an execution plan for: ${task}` },
      ],
    });

    const text = response.choices?.[0]?.message?.content || '';

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
}

module.exports = Planner;
