// sub-agents/self-improve.js
// The agent that reads its own source code, finds improvements,
// refactors, runs tests, and commits to GitHub.

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const { createMessage } = require('./llm');

// Files the agent is allowed to read and potentially improve
const AGENT_FILES = [
  'router.js',
  'meta-agent.js',
  'sub-agents/planner.js',
  'sub-agents/executor.js',
  'sub-agents/memory.js',
  'sub-agents/self-improve.js',
];

const WORKDIR = process.env.AGENT_WORKDIR || process.cwd();

// ─── Step 1: Analyze ─────────────────────────────────────────────────────────

async function analyzeCode(onStep) {
  onStep('Čtu vlastní zdrojový kód...');

  const sources = {};
  for (const file of AGENT_FILES) {
    try {
      const full = path.join(WORKDIR, file);
      sources[file] = await fs.readFile(full, 'utf-8');
    } catch {
      sources[file] = '// file not found';
    }
  }

  const combined = Object.entries(sources)
    .map(([f, c]) => `// ===== ${f} =====\n${c}`)
    .join('\n\n');

  onStep('Analyzuji kvalitu kódu...');

  const res = await createMessage({
    maxTokens: 2048,
    system: `You are a senior software engineer doing a code review of an AI agent system.
Find real, concrete improvements. Focus on: error handling, code duplication, performance, maintainability.
Return JSON only: { "score": 1-10, "issues": [{ "file": "...", "line_hint": "...", "severity": "low|medium|high", "description": "...", "fix": "..." }] }`,
    messages: [{
      role: 'user',
      content: `Analyze this AI agent codebase:\n\n${combined.slice(0, 12000)}`,
    }],
  });

  const text = res.text;
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { score: 7, issues: [] };
  }
}

// ─── Step 2: Generate Improvements ───────────────────────────────────────────

async function generateFixes(analysis, onStep) {
  const highPriority = analysis.issues.filter(i => i.severity === 'high' || i.severity === 'medium');
  if (!highPriority.length) {
    onStep('Žádné kritické problémy nenalezeny.');
    return [];
  }

  onStep(`Generuji opravy pro ${highPriority.length} problémů...`);

  const fixes = [];
  for (const issue of highPriority.slice(0, 3)) { // max 3 fixes per run
    const filePath = path.join(WORKDIR, issue.file);
    let original = '';
    try {
      original = await fs.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: `You are refactoring agent code. Return ONLY the complete improved file content — no explanation, no markdown fences.`,
      messages: [{
        role: 'user',
        content: `Fix this issue in ${issue.file}:\n\nProblem: ${issue.description}\nSuggested fix: ${issue.fix}\n\nCurrent file:\n${original}`,
      }],
    });

    const improved = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    fixes.push({ file: issue.file, original, improved, issue });
  }

  return fixes;
}

// ─── Step 3: Test ─────────────────────────────────────────────────────────────

async function runTests(onStep) {
  onStep('Spouštím testy...');

  // Try common test runners
  const testCommands = [
    'npm test --if-present',
    'node -e "require(\'./meta-agent\')" 2>&1',
    'node -e "require(\'./sub-agents/executor\')" 2>&1',
  ];

  const results = [];
  for (const cmd of testCommands) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: WORKDIR, timeout: 20000 });
      results.push({ cmd, ok: true, output: (stdout + stderr).trim().slice(0, 500) });
    } catch (err) {
      results.push({ cmd, ok: false, error: err.message.slice(0, 300) });
    }
  }

  const passed = results.filter(r => r.ok).length;
  onStep(`Testy: ${passed}/${results.length} prošlo`);
  return results;
}

// ─── Step 4: Apply + Commit ───────────────────────────────────────────────────

async function applyAndCommit(fixes, testResults, onStep) {
  if (!fixes.length) {
    onStep('Žádné opravy k aplikování.');
    return 'Kód je v pořádku — žádné změny nebyly nutné.';
  }

  // Only apply if tests didn't catastrophically fail
  const criticalFailures = testResults.filter(r => !r.ok && r.cmd.includes('require'));
  if (criticalFailures.length > 1) {
    return '⚠️ Příliš mnoho test failures před aplikováním změn — přeskočeno pro bezpečnost.';
  }

  onStep('Aplikuji opravy...');
  const appliedFiles = [];

  for (const fix of fixes) {
    const fullPath = path.join(WORKDIR, fix.file);
    // Backup original
    await fs.writeFile(`${fullPath}.bak`, fix.original, 'utf-8');
    // Apply improvement
    await fs.writeFile(fullPath, fix.improved, 'utf-8');
    appliedFiles.push(fix.file);
    onStep(`✅ Opraveno: ${fix.file}`);
  }

  // Git commit
  onStep('Commituju změny do GitHubu...');
  const commitMsg = `🤖 self-improve: ${appliedFiles.join(', ')} (auto-refactor)`;

  try {
    await execAsync(`git -C "${WORKDIR}" remote set-url origin https://${process.env.GIT_TOKEN}@github.com/${process.env.GITHUB_USERNAME}/openclaw-agent.git`, {});
    await execAsync(`git -C "${WORKDIR}" add ${appliedFiles.map(f => `"${f}"`).join(' ')}`, {});
    await execAsync(`git -C "${WORKDIR}" commit -m "${commitMsg}"`, {});

    const pushCmd = `git -C "${WORKDIR}" push origin ${process.env.GIT_BRANCH || 'main'}`;
    await execAsync(pushCmd, {});

    onStep('📦 Pushnuté na GitHub!');
    return `✅ Self-improve dokončen:\n• Opravené soubory: ${appliedFiles.join(', ')}\n• Commit: "${commitMsg}"\n• Pushnuté na GitHub`;
  } catch (err) {
    onStep(`⚠️ Git chyba: ${err.message}`);
    return `⚠️ Soubory opraveny lokálně, ale git push selhal: ${err.message}`;
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

class SelfImprove {
  async run(onStep = () => {}) {
    onStep('🧬 Spouštím self-improve cyklus...');

    // 1. Analyze
    const analysis = await analyzeCode(onStep);
    onStep(`📊 Skóre kódu: ${analysis.score}/10 | Nalezeno: ${analysis.issues.length} problémů`);

    if (analysis.score >= 9) {
      return `✅ Kód je vynikající (${analysis.score}/10). Žádné změny nebyly nutné.`;
    }

    // 2. Generate fixes
    const fixes = await generateFixes(analysis, onStep);

    // 3. Test current state
    const testResults = await runTests(onStep);

    // 4. Apply + commit
    const result = await applyAndCommit(fixes, testResults, onStep);

    return result;
  }
}

module.exports = SelfImprove;
