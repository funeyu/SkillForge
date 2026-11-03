const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
for (const directory of ['', 'electron', 'services', 'scripts', 'skills/skillforge/scripts']) {
  for (const name of readdirSync(path.join(root, directory))) {
    if (!/\.(?:cjs|js)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, name)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
