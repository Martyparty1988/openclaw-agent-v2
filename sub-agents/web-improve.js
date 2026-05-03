// sub-agents/web-improve.js
// Agent that reads its own website, finds UX/content improvements,
// rewrites sections, and commits to GitHub — fully autonomous.

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const { createMessage } = require('./llm');

const WEB_DIR = path.resolve(process.env.WEB_DIR || './web');
const WORKDIR = process.env.AGENT_WORKDIR || process.cwd();

// ─── Step 1: Audit ────────────────────────────────────────────────────────────

async function auditWebsite(onStep) {
  onStep('📄 Čtu vlastní web...');

  const indexPath = path.join(WEB_DIR, 'index.html');
  const html = await fs.readFile(indexPath, 'utf-8');

  onStep('🔍 Claude analyzuje UX, obsah a kód...');

  const res = await createMessage({
    maxTokens: 2048,
    system: `You are a senior UX engineer and frontend developer auditing a website.
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
    messages: [{
      role: 'user',
      content: `Audit this website HTML (first 10000 chars):\n\n${html.slice(0, 10000)}`,
    }],
  });

  const text = res.text;
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { score: 7, issues: [], missing_sections: [], copy_improvements: [] };
  }
}

// ─── Step 2: Generate improved HTML ──────────────────────────────────────────

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

  const res = await createMessage({
    maxTokens: 8000,
    system: `You are a senior frontend developer improving a website.
Apply the requested fixes and return the COMPLETE improved HTML file — nothing else.
No markdown fences, no explanation. Just the full HTML.
Keep the existing design aesthetic. Do not change visual style unless fixing a bug.`,
    messages: [{
      role: 'user',
      content: `Improve this HTML file by fixing these issues:

ISSUES TO FIX:
${issueList || 'none'}

COPY IMPROVEMENTS:
${copyList || 'none'}

MISSING SECTIONS TO ADD:
${missingSections || 'none'}

CURRENT HTML:
${currentHtml}`,
    }],
  });

  return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ─── Step 3: Validate ─────────────────────────────────────────────────────────

async function validateHtml(html, onStep) {
  onStep('🧪 Validuji HTML...');

  // Basic sanity checks
  const checks = [
    { name: 'DOCTYPE', ok: html.includes('<!DOCTYPE html>') },
    { name: '<html>', ok: html.includes('<html') },
    { name: '<head>', ok: html.includes('<head>') },
    { name: '<body>', ok: html.includes('<body>') },
    { name: 'closing </html>', ok: html.includes('</html>') },
    { name: 'not empty', ok: html.length > 500 },
  ];

  const failed = checks.filter(c => !c.ok);
  if (failed.length) {
    return { valid: false, reason: `Missing: ${failed.map(c => c.name).join(', ')}` };
  }

  return { valid: true };
}

// ─── Step 4: Apply + Commit ───────────────────────────────────────────────────

async function applyAndCommit(improvedHtml, audit, onStep) {
  const indexPath = path.join(WEB_DIR, 'index.html');

  // Backup
  const backupPath = `${indexPath}.bak`;
  await fs.copyFile(indexPath, backupPath);

  // Write improved version
  await fs.writeFile(indexPath, improvedHtml, 'utf-8');
  onStep('✅ index.html aktualizován');

  // Git commit
  const issueCount = audit.issues.filter(i => i.severity !== 'low').length;
  const commitMsg = `🌐 web-improve: ${issueCount} fixes, score ${audit.score}→improved (auto)`;

  try {
    await execAsync(`git -C "${WORKDIR}" remote set-url origin https://${process.env.GIT_TOKEN}@github.com/${process.env.GITHUB_USERNAME}/openclaw-agent.git`, {});
    await execAsync(`git -C "${WORKDIR}" add "${indexPath}"`, {});
    await execAsync(`git -C "${WORKDIR}" commit -m "${commitMsg}"`, {});
    const branch = process.env.GIT_BRANCH || 'main';
    await execAsync(`git -C "${WORKDIR}" push origin ${branch}`, {});
    onStep('📦 Pushnuté na GitHub!');
    return `✅ Web vylepšen a pushnut:\n• Opraveno: ${issueCount} problémů\n• Commit: "${commitMsg}"`;
  } catch (err) {
    onStep(`⚠️  Git push selhal: ${err.message}`);
    return `⚠️  Web aktualizován lokálně, git push selhal: ${err.message}`;
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

class WebImprove {
  async run(onStep = () => {}) {
    onStep('🌐 Spouštím web-improve cyklus...');

    // 1. Audit
    const audit = await auditWebsite(onStep);
    onStep(`📊 Web skóre: ${audit.score}/10 | Nalezeno: ${audit.issues.length} problémů`);

    if (audit.score >= 9 && !audit.copy_improvements.length) {
      return `✅ Web je výborný (${audit.score}/10). Žádné změny nebyly nutné.`;
    }

    // 2. Read current HTML
    const indexPath = path.join(WEB_DIR, 'index.html');
    const currentHtml = await fs.readFile(indexPath, 'utf-8');

    // 3. Generate improvement
    const improvedHtml = await generateImprovedHtml(audit, currentHtml, onStep);
    if (!improvedHtml) return `ℹ️  Web skóre: ${audit.score}/10 — žádné zásadní změny potřeba.`;

    // 4. Validate
    const validation = await validateHtml(improvedHtml, onStep);
    if (!validation.valid) {
      return `❌ Vygenerovaný HTML je neplatný: ${validation.reason}. Změny nebyly aplikovány.`;
    }

    // 5. Apply + commit
    return await applyAndCommit(improvedHtml, audit, onStep);
  }
}

module.exports = WebImprove;
