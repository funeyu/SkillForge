const { existsSync } = require('node:fs');
const path = require('node:path');

function applicationPaths() {
  const root = path.resolve(__dirname, '..');
  const executable = process.platform === 'darwin'
    ? path.resolve(root, '../../MacOS/SkillForge')
    : path.resolve(root, '../..', process.platform === 'win32' ? 'SkillForge.exe' : 'skillforge');
  const packaged = existsSync(executable);
  return { root, executable: packaged ? executable : undefined, resources: packaged ? path.dirname(root) : root };
}

module.exports = { applicationPaths };
