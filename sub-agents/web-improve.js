// sub-agents/web-improve.js
// Agent that reads its own website, finds UX/content improvements,
// rewrites sections, and commits to GitHub — fully autonomous.

const OpenAI = require('openai');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

const WEB_DIR = path.resolve(process.env.WEB_DIR || './web');
const WORKDIR = process.env.AGENT_WORKDIR || process.cwd();

async function ask(system, user, temperature = 0.2) {
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return res.choices?.[0]?.message?.content || '';
}

async function auditWebsite(onStep) {
  onStep('📄 Čtu vlastní web...');
  const indexPath = path.join(WEB_DIR, 'index.html');
  const html = await fs.readFile(indexPath, 'utf-8');
  onStep('🔍 OpenAI analyzuje UX, obsah a kód...');

  const text = await ask(
    `You are a senior UX engineer and frontend developer auditing a website.
Find concrete improvements in: content clarity, missing sections, copy quality, HTML/CSS bugs, accessibility, performance, SEO.
Return JSON only: {
  "score": 1-10,
  "issues": [{
    "area": "content|ux|code|seo|accessibility",
    "severity": "low|medium|high",
    "description": "...",
    "suggestion": "..."
  }],
  "missing_sections": ["..."],
  "copy_improvements": [{ "selector": "css-selector-hint", "current": "...", "improved": "..." }]
}`,
    `Audit this website HTML (first 10000 chars):\n\n${html.slice(0, 10000)}`
  );

  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return { score: 7, issues: [], missing_sections: [], copy_improvements: [] }; }
}

async function generateImprovedHtml(audit, currentHtml, onStep) {
  const highIssues = audit.issues.filter(i => i.severity === 'high' || i.severity === 'medium');
  if (!highIssues.length && !audit.copy_improvements.length) {
    onStep('✅ Web je v pořádku — žádné kritické problémy.');
    return null;
  }

  onStep(`✏️  Generuji vylepšený HTML (${highIssues.length} problémů, ${audit.copy_improvements.length} copy fix)...`);
  const issueList = highIssues.map(i => `[${i.area}/${i.severity}] ${i.description} → ${i.suggestion}`).join('\n');
  const copyList = audit.copy_improvements.map(c => `"${c.current}" → "${c.improved}"`).join('\n');
  const missingSections = audit.missing_sections.join(', ');

  return ask(
    `You are a senior frontend developer improving a website.
Apply the requested fixes and return the COMPLETE improved HTML file — nothing else.
No markdown fences, no explanation. Just the full HTML.
Keep the existing design aesthetic. Do not change visual style unless fixing a bug.`,
    `Current HTML:\n\n${currentHtml.slice(0, 18000)}\n\nIssues:\n${issueList}\n\nCopy improvements:\n${copyList}\n\nMissing sections to add if relevant:\n${missingSections}`,
    0.1
  );
}

async function maybeCommit(onStep) {
  const branch = process.env.GIT_BRANCH || 'main';
  const msg = `web: automated UX/content improvements`;
  try {
    await execAsync('git add web/index.html', { cwd: WORKDIR });
    const { stdout } = await execAsync(`git commit -m "${msg}"`, { cwd: WORKDIR });
    onStep('✅ Commit vytvořen.');
    if (process.env.GIT_TOKEN) {
      await execAsync(`git push origin ${branch}`, { cwd: WORKDIR });
      onStep('🚀 Změny pushnuty na GitHub.');
    }
    return stdout.trim();
  } catch (err) {
    if (String(err.message).includes('nothing to commit')) return 'No changes to commit.';
    throw err;
  }
}

class WebImprove {
  async run(onStep = () => {}) {
    const indexPath = path.join(WEB_DIR, 'index.html');
    const current = await fs.readFile(indexPath, 'utf-8');
    const audit = await auditWebsite(onStep);
    const improved = await generateImprovedHtml(audit, current, onStep);
    if (!improved || improved.trim() === current.trim()) return 'Žádné změny nebyly potřeba.';
    await fs.writeFile(indexPath, improved, 'utf-8');
    onStep('💾 Uloženo do web/index.html');
    const commit = await maybeCommit(onStep);
    return `Skóre: ${audit.score}/10\nIssues: ${audit.issues.length}\n${commit}`;
  }
}

module.exports = WebImprove;
