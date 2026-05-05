// Railway compatibility wrapper.
// If Railway Root Directory is stuck on "main", Nixpacks runs from this folder.
// This script copies the real app from the repository root into ./main before start.

const fs = require('fs');
const path = require('path');

const here = __dirname;
const root = path.resolve(here, '..');

const items = [
  'router.js',
  'router-v2.js',
  'meta-agent.js',
  'meta-agent-v2.js',
  'sub-agents',
  'scripts',
  'web',
  'supabase',
  'railway.json',
  'vercel.json',
];

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function copyItem(name) {
  const src = path.join(root, name);
  const dest = path.join(here, name);

  if (!exists(src)) {
    console.warn(`[prepare-main] Missing source, skipped: ${name}`);
    return;
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[prepare-main] Copied ${name}`);
}

for (const item of items) copyItem(item);

console.log('[prepare-main] Railway main wrapper prepared.');
