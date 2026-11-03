const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtime = process.env.SKILLFORGE_SPEECH_RUNTIME || path.join(root, '.venv-speech');
const python = process.env.SKILLFORGE_SPEECH_PYTHON || path.join(runtime, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function run(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`语音运行时打包失败（退出码 ${result.status}）`);
}

try {
  if (!existsSync(python)) throw new Error('请先运行 npm run prepare:speech');
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  run(['-m', 'pip', 'install', '--disable-pip-version-check', 'pyinstaller==6.22.3']);
  run([
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
    '--name', 'skillforge-speech', '--distpath', 'dist/speech',
    '--workpath', 'dist/pyinstaller', '--specpath', 'dist',
    '--collect-all', 'faster_whisper', '--collect-all', 'ctranslate2',
    '--collect-all', 'onnxruntime', '--collect-all', 'tokenizers',
    'services/speech-worker.py'
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
