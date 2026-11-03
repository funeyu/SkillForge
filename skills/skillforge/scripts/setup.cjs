const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const version = '0.0.1';
const asset = `SkillForge-${version}-macos-arm64.zip`;
const release = `https://github.com/funeyu/SkillForge/releases/download/${version}`;
const report = message => process.stderr.write(`[SkillForge] ${message}\n`);
const appRoot = directory => path.join(directory, 'Contents/Resources/app');

function run(executable, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000, killSignal: 'SIGKILL' });
    let output = '';
    let errors = '';
    const started = Date.now();
    const heartbeat = setInterval(() => report(`仍在处理，已用时 ${Math.round((Date.now() - started) / 1000)} 秒…`), 3000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8192); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearInterval(heartbeat); reject(error); });
    child.on('close', (code, signal) => {
      clearInterval(heartbeat);
      if (code !== 0) reject(new Error(`${path.basename(executable)} 执行失败（${signal || code}）：${errors.trim()}${path.basename(executable) === 'ditto' ? '' : '。若被 macOS 拦截，请确认来源后在「隐私与安全性」中允许打开；不会自动绕过安全检查。'}`));
      else resolve(output);
    });
    child.stdin.end(input);
  });
}

async function download(url, destination, expectedHash) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let received = 0;
  let lastReport = 0;
  const progress = () => report(`下载 ${path.basename(destination)}：${total ? `${Math.min(100, received / total * 100).toFixed(1)}% · ` : ''}${(received / 1048576).toFixed(1)} MiB${total ? ` / ${(total / 1048576).toFixed(1)} MiB` : ''}`);
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      if (Date.now() - lastReport > 500) { progress(); lastReport = Date.now(); }
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  progress();
  if (total && total !== received) throw new Error('下载不完整，请重新运行 setup');
  if (expectedHash && hash.digest('hex') !== expectedHash) throw new Error('安装包 SHA-256 校验失败，未安装，请重新运行 setup');
}

function checksumFor(text, filename) {
  const matches = text.split(/\r?\n/).map(line => line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)).filter(match => match && match[2] === filename);
  if (matches.length !== 1) throw new Error(`SHA256SUMS.txt 缺少或重复列出 ${filename}`);
  return matches[0][1].toLowerCase();
}

async function validate(root, full = false) {
  for (const file of ['package.json', 'scripts/agent.cjs', 'services/application-paths.cjs']) await fsp.access(path.join(root, file));
  if (JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')).name !== 'skillforge') throw new Error(`不是 SkillForge 运行目录：${root}`);
  const packaged = path.basename(root) === 'app' && path.basename(path.dirname(root)) === 'Resources';
  const resources = packaged ? path.dirname(root) : root;
  if (packaged) {
    await fsp.access(path.resolve(root, '../../MacOS/SkillForge'), fs.constants.X_OK);
  } else {
    const electron = require(require.resolve('electron', { paths: [root] }));
    await fsp.access(electron, fs.constants.X_OK);
  }
  for (const dependency of ['@mozilla/readability', 'jsdom', 'three']) require.resolve(dependency, { paths: [root] });
  const model = path.join(resources, 'models/speech/base');
  const manifest = JSON.parse(await fsp.readFile(path.join(resources, 'models/speech/manifest.json'), 'utf8'));
  for (const file of manifest.models.base.files) {
    if (path.basename(file.name) !== file.name) throw new Error('模型清单路径无效');
    const filename = path.join(model, file.name);
    if ((await fsp.stat(filename)).size !== file.size) throw new Error(`语音模型不完整：${file.name}`);
    if (full) {
      const hash = createHash(file.algorithm);
      if (file.algorithm === 'sha1') hash.update(`blob ${file.size}\0`);
      for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
      if (hash.digest('hex') !== file.hash) throw new Error(`语音模型校验失败：${file.name}`);
    }
  }
  const worker = packaged ? path.join(resources, 'speech-runtime/skillforge-speech')
    : process.env.SKILLFORGE_SPEECH_PYTHON || path.join(process.env.SKILLFORGE_SPEECH_RUNTIME || path.join(root, '.venv-speech'), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await fsp.access(worker, fs.constants.X_OK);
  if (full) {
    const output = await run(worker, [...(packaged ? [] : [path.join(root, 'services/speech-worker.py')]), '--model', model], '{"event":"finish"}\n');
    const events = output.trim().split('\n').map(line => { try { return JSON.parse(line).event; } catch { return undefined; } });
    if (!events.includes('ready') || !events.includes('done') || events.includes('error')) throw new Error('独立语音运行时自检失败');
  }
}

async function ensureRuntime(skillDirectory, { full = false } = {}) {
  const config = path.join(skillDirectory, 'runtime.json');
  if (fs.existsSync(config)) {
    const runtime = JSON.parse(await fsp.readFile(config, 'utf8'));
    if (!runtime.root || !path.isAbsolute(runtime.root)) throw new Error(`请修正 ${config} 中的 root 绝对路径`);
    if (full) report('[1/5] 检查已绑定应用、依赖和语音运行时…');
    await validate(runtime.root, full);
    if (full) report('[5/5] 已绑定应用及语音运行时校验完成');
    return runtime;
  }
  report('[1/5] 检测 SkillForge 桌面应用和语音运行时…');
  const source = path.resolve(skillDirectory, '../..');
  const applications = path.resolve(process.env.SKILLFORGE_APP_DIR || path.join(os.homedir(), 'Applications'));
  const destination = path.join(applications, 'SkillForge.app');
  let root;
  if (fs.existsSync(path.join(source, 'scripts/agent.cjs'))) {
    root = source;
    await validate(root, true);
  } else {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('自动安装目前仅支持 macOS Apple Silicon（arm64）。其他平台请配置源码运行环境和 runtime.json；不会下载不兼容的安装包。');
    for (const directory of [destination, '/Applications/SkillForge.app']) {
      if (!fs.existsSync(directory)) continue;
      root = appRoot(directory);
      report(`[2/5] 使用已安装应用：${directory}；校验依赖和语音运行时…`);
      await validate(root, true);
      break;
    }
    if (!root) {
      await fsp.mkdir(applications, { recursive: true });
      const lock = path.join(applications, '.skillforge-install.lock');
      try { await fsp.mkdir(lock); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        throw new Error(`另一个安装可能正在进行。请等待后重试；若上次被强制终止，确认无安装进程后移除 ${lock}`);
      }
      let staging;
      try {
        staging = await fsp.mkdtemp(path.join(applications, '.skillforge-install-'));
        report(`[2/5] 下载桌面应用 ${version}（包含 Electron、依赖、语音模型及独立运行时）…`);
        const sums = path.join(staging, 'SHA256SUMS.txt');
        await download(`${release}/SHA256SUMS.txt`, sums);
        const expectedHash = checksumFor(await fsp.readFile(sums, 'utf8'), asset);
        const archive = path.join(staging, asset);
        await download(`${release}/${asset}`, archive, expectedHash);
        report('[3/5] SHA-256 校验通过，正在解压应用…');
        const unpacked = path.join(staging, 'unpacked');
        await run('/usr/bin/ditto', ['-x', '-k', archive, unpacked]);
        const stagedApp = path.join(unpacked, 'SkillForge.app');
        report('[4/5] 校验应用依赖、语音模型，启动独立语音运行时自检…');
        await validate(appRoot(stagedApp), true);
        if (fs.existsSync(destination)) throw new Error(`目标已存在，未覆盖：${destination}`);
        await fsp.rename(stagedApp, destination);
        root = appRoot(destination);
      } finally {
        try { if (staging) await fsp.rm(staging, { recursive: true, force: true }); }
        finally { await fsp.rm(lock, { recursive: true, force: true }); }
      }
    }
  }
  const skillsDir = path.dirname(skillDirectory);
  const agent = skillsDir.split(path.sep).includes('.claude') ? 'claude' : skillsDir.split(path.sep).includes('.codex') ? 'codex' : 'generic';
  const runtime = { root, defaults: { agent, skillsDir } };
  try { await fsp.writeFile(config, JSON.stringify(runtime, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return ensureRuntime(skillDirectory, { full });
  }
  report(`[5/5] 安装完成，桌面应用、依赖和语音运行时已就绪：${root}`);
  return runtime;
}

module.exports = { ensureRuntime, checksumFor, download, validate };
