const fs = require('node:fs');
const path = require('node:path');

function initAgent() {
  const configPath = path.join(process.cwd(), 'agent-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing agent-config.json');
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  console.log('🤖 Spouštím Developer Agent...');
  console.log(`Agent: ${config?.agent?.name || 'unknown'}`);
  console.log(`Role: ${config?.agent?.role || 'unknown'}`);
}

initAgent();
