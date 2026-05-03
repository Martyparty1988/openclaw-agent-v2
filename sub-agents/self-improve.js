// sub-agents/self-improve.js
const OpenAI = require('openai');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

const AGENT_FILES = ['router.js','meta-agent.js','sub-agents/planner.js','sub-agents/executor.js','sub-agents/memory.js','sub-agents/self-improve.js'];
const WORKDIR = process.env.AGENT_WORKDIR || process.cwd();

async function ask(system, user, temperature = 0.2) {
  const res = await client.chat.completions.create({ model: MODEL, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  return res.choices?.[0]?.message?.content || '';
}

async function analyzeCode(onStep) {
  onStep('Čtu vlastní zdrojový kód...');
  const sources = {};
  for (const file of AGENT_FILES) {
    try { sources[file] = await fs.readFile(path.join(WORKDIR, file), 'utf-8'); }
    catch { sources[file] = '// file not found'; }
  }
  const combined = Object.entries(sources).map(([f, c]) => `// ===== ${f} =====\n${c}`).join('\n\n');
  onStep('Analyzuji kvalitu kódu...');
  const text = await ask(
    `You are a senior software engineer doing a code review of an AI agent system.
Find real, concrete improvements. Focus on: error handling, code duplication, performance, maintainability.
Return JSON only: { "score": 1-10, "issues": [{ "file": "...", "line_hint": "...", "severity": "low|medium|high", "description": "...", "fix": "..." }] }`,
    `Analyze this AI agent codebase:\n\n${combined.slice(0, 12000)}`
  );
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return { score: 7, issues: [] }; }
}

class SelfImprove {
  async run(onStep = () => {}) {
    const analysis = await analyzeCode(onStep);
    return `Self-review complete. Score: ${analysis.score}/10. Issues found: ${analysis.issues.length}.`;
  }
}

module.exports = SelfImprove;
