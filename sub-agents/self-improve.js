// sub-agents/self-improve.js
// Safe self-improve cycle: read code, propose fixes with Claude, apply locally,
// test, then commit/push only when AGENT_WORKDIR is a real git repository.
// Secrets stay in Railway Variables. This file never stores API keys or tokens.

const Anthropic = require('@anthropic-ai/sdk');
const { exec, execFile } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
const WORKDIR = path.resolve(process.env.AGENT_WORKDIR || process.cwd());

const AGENT_FILES = [
  'router-full-web.js',
  'meta-agent-v2.js',
  'start-full-web.js',
  'sub-agents/planner.js',
  'sub-agents/executor.js',
  'sub-agents/memory.js',
  'sub-agents/self-improve.js',
  'sub-agents/web-improve.js',
  'sub-agents/email.js',
  'sub-agents/learner.js',
  'sub-agents/model-presets.js',
  'sub-agents/git-workspace.js',
  'sub-agents/auto-worker.js',
  'scripts/ensure-git-workdir.js',
];

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is missing. Self-improve requires Claude/Anthropic.');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function safePath(file) {
  const full = path.resolve(WORKDIR, file);
  if (!full.startsWith(WORKDIR)) throw new Error(`Unsafe file path rejected: ${file}`);
  return full;
}

async function isGitRepo() {
  try {
    await fs.access(path.join(WORKDIR, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function makeAskPass() {
  const dir = '/tmp/martybot-git';
  const file = path.join(dir, 'askpass.sh');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, [
    '#!/bin/sh',
    'case "$1" in',
    '  *Username*) echo "x-access-token" ;;',
    '  *Password*) echo "$GIT_TOKEN" ;;',
    '  *) echo "" ;;',
    'esac',
    '',
  ].join('\n'), 'utf-8');
  await fs.chmod(file, 0o700);
  return file;
}

async function runGit(args, timeout = 60000) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };

  if (process.env.GIT_TOKEN) {
    env.GIT_ASKPASS = await makeAskPass();
  }

  return execFileAsync('git', ['-C', WORKDIR, ...args], {
    env,
    timeout,
    maxBuffer: 1024 * 1024,
  });
}

function explainGitSetup() {
  return [
    '⚠️ Git push není aktivní, protože pracovní složka není skutečný git repozitář nebo chybí remote.',
    '',
    'Bezpečné nastavení pro Railway:',
    '1. Tajné hodnoty nech pouze v Railway Variables.',
    '2. Nastav AGENT_WORKDIR=/data/openclaw-agent-v2.',
    '3. Nastav GITHUB_REPO=Martyparty1988/openclaw-agent-v2.',
    '4. Nastav GIT_BRANCH=main.',
    '5. Nastav GIT_TOKEN s oprávněním Contents: Read and write.',
    '6. Spusť /git setup.',
    '',
    `Aktuální AGENT_WORKDIR: ${WORKDIR}`,
  ].join('\n');
}

async function readSourceFiles(onStep) {
  onStep('Čtu vlastní zdrojový kód...');
  const sources = {};

  for (const file of AGENT_FILES) {
    try {
      sources[file] = await fs.readFile(safePath(file), 'utf-8');
    } catch {
      sources[file] = '// file not found';
    }
  }

  return sources;
}

async function analyzeCode(onStep) {
  const client = getAnthropicClient();
  const sources = await readSourceFiles(onStep);
  const combined = Object.entries(sources)
    .map(([file, content]) => `// ===== ${file} =====\n${content}`)
    .join('\n\n');

  onStep('Analyzuji kvalitu kódu...');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: `You are a senior software engineer reviewing an AI agent codebase.
Find concrete improvements. Focus on security, error handling, maintainability, tests, and safe automation.
Return JSON only: { "score": 1-10, "issues": [{ "file": "...", "severity": "low|medium|high", "description": "...", "fix": "..." }] }`,
    messages: [{ role: 'user', content: `Analyze this codebase:\n\n${combined.slice(0, 14000)}` }],
  });

  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { score: 7, issues: [] };
  }
}

async function generateFixes(analysis, onStep) {
  const client = getAnthropicClient();
  const issues = analysis.issues.filter((i) => i.severity === 'high' || i.severity === 'medium');

  if (!issues.length) {
    onStep('Žádné kritické problémy nenalezeny.');
    return [];
  }

  onStep(`Generuji opravy pro ${Math.min(issues.length, 3)} problémů...`);
  const fixes = [];

  for (const issue of issues.slice(0, 3)) {
    if (!AGENT_FILES.includes(issue.file)) {
      onStep(`Přeskakuji nepovolený soubor: ${issue.file}`);
      continue;
    }

    let original = '';
    try {
      original = await fs.readFile(safePath(issue.file), 'utf-8');
    } catch {
      continue;
    }

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: 'Return only the complete improved file content. No markdown fences. No explanation.',
      messages: [{ role: 'user', content: `Fix this issue in ${issue.file}:\n${issue.description}\nSuggested fix: ${issue.fix}\n\nCurrent file:\n${original}` }],
    });

    const improved = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!improved || improved.length < 50 || improved === original) {
      onStep(`Přeskakuji prázdnou nebo stejnou opravu: ${issue.file}`);
      continue;
    }

    fixes.push({ file: issue.file, original, improved });
  }

  return fixes;
}

async function runTests(onStep) {
  onStep('Spouštím testy...');

  const commands = [
    'npm run check --if-present',
    'node --check router.js',
    'node --check meta-agent-v2.js',
    'node --check sub-agents/executor.js',
    'node --check sub-agents/memory.js',
    'node --check sub-agents/self-improve.js',
    'node --check sub-agents/git-workspace.js',
    'node --check sub-agents/auto-worker.js',
  ];

  const results = [];
  for (const cmd of commands) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: WORKDIR, timeout: 30000 });
      results.push({ cmd, ok: true, output: (stdout + stderr).trim().slice(0, 500) });
    } catch (err) {
      results.push({ cmd, ok: false, error: (err.stderr || err.message || '').slice(0, 900) });
    }
  }

  onStep(`Testy: ${results.filter((r) => r.ok).length}/${results.length} prošlo`);
  return results;
}

async function applyFixes(fixes, onStep) {
  const applied = [];

  for (const fix of fixes) {
    const filePath = safePath(fix.file);
    await fs.writeFile(`${filePath}.bak`, fix.original, 'utf-8');
    await fs.writeFile(filePath, fix.improved, 'utf-8');
    applied.push(fix.file);
    onStep(`✅ Opraveno lokálně: ${fix.file}`);
  }

  return applied;
}

async function revertFixes(fixes, onStep) {
  for (const fix of fixes) {
    await fs.writeFile(safePath(fix.file), fix.original, 'utf-8');
    onStep(`↩️ Vráceno zpět: ${fix.file}`);
  }
}

async function commitAndPush(files, onStep) {
  if (!(await isGitRepo())) return explainGitSetup();

  if (!process.env.GIT_TOKEN && !process.env.GIT_REMOTE_URL) {
    return [
      '⚠️ Změny jsou lokálně hotové, ale push přeskočen.',
      'Důvod: chybí GIT_TOKEN nebo GIT_REMOTE_URL v Railway Variables.',
      'Doporučení: nastav GIT_TOKEN s oprávněním Contents: Read and write a spusť /git setup.',
    ].join('\n');
  }

  await runGit(['config', 'user.email', 'martybot@users.noreply.github.com']);
  await runGit(['config', 'user.name', 'Martybot']);

  if (process.env.GIT_REMOTE_URL) {
    onStep('Nastavuji git remote z Railway Variables...');
    await runGit(['remote', 'set-url', 'origin', process.env.GIT_REMOTE_URL]);
  } else {
    const repo = process.env.GITHUB_REPO || 'Martyparty1988/openclaw-agent-v2';
    await runGit(['remote', 'set-url', 'origin', `https://github.com/${repo}.git`]);
  }

  onStep('Commituju změny...');
  await runGit(['add', ...files]);
  const status = await runGit(['status', '--porcelain']);
  if (!status.stdout.trim()) return 'ℹ️ Není co commitnout.';

  const msg = `self-improve: update ${files.join(', ')}`;
  await runGit(['commit', '-m', msg]);

  onStep('Pushuju změny na GitHub...');
  await runGit(['push', 'origin', process.env.GIT_BRANCH || 'main'], 120000);
  return `✅ Pushnuté na GitHub. Commit: ${msg}`;
}

class SelfImprove {
  async run(onStep = () => {}) {
    onStep('🧬 Spouštím bezpečný self-improve cyklus...');

    const analysis = await analyzeCode(onStep);
    onStep(`📊 Skóre kódu: ${analysis.score}/10 | Nalezeno: ${analysis.issues.length} problémů`);

    if (analysis.score >= 9) return `✅ Kód je výborný (${analysis.score}/10). Žádné změny nebyly nutné.`;

    const fixes = await generateFixes(analysis, onStep);
    if (!fixes.length) return 'ℹ️ Nebyly vygenerovány žádné bezpečné opravy.';

    const applied = await applyFixes(fixes, onStep);
    const tests = await runTests(onStep);
    const failed = tests.filter((r) => !r.ok);

    if (failed.length) {
      await revertFixes(fixes, onStep);
      return `❌ Testy po změnách selhaly. Změny byly vráceny zpět.\n\n${failed.map((r) => `• ${r.cmd}: ${r.error}`).join('\n')}`;
    }

    try {
      const gitResult = await commitAndPush(applied, onStep);
      return `✅ Self-improve dokončen.\n• Opraveno: ${applied.join(', ')}\n\n${gitResult}`;
    } catch (err) {
      return `⚠️ Opravy proběhly, ale git push selhal: ${err.message}`;
    }
  }
}

module.exports = SelfImprove;
