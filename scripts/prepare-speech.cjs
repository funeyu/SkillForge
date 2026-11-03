const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`命令执行失败：${executable}（${result.status}）`);
}

try {
  const root = path.join(__dirname, '..');
  const runtime = process.env.SKILLFORGE_SPEECH_RUNTIME || path.join(root, '.venv-speech');
  const python = path.join(runtime, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) {
    const candidates = process.env.PYTHON ? [process.env.PYTHON] : ['python3.12', 'python3.11', 'python3', 'python'];
    const selected = candidates.find(candidate => spawnSync(candidate, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { stdio: 'ignore' }).status === 0);
    if (!selected) throw new Error('请先安装 Python 3.10+，或用 PYTHON 指定解释器');
    run(selected, ['-m', 'venv', runtime]);
  }
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(__dirname, 'requirements-speech.txt')]);
  run(process.execPath, [path.join(__dirname, 'check-speech-model.cjs')]);
  console.log('SkillForge 本地语音环境已就绪，识别时不会联网下载模型');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
