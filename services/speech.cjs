const { spawn } = require('node:child_process');
const { access, mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { applicationPaths } = require('./application-paths.cjs');

function runtimePaths(options = {}) {
  const { root, resources, executable } = applicationPaths();
  const modelRoot = options.modelDirectory || process.env.SKILLFORGE_SPEECH_MODELS || path.join(resources, 'models/speech');
  const runtime = process.env.SKILLFORGE_SPEECH_RUNTIME || path.join(root, '.venv-speech');
  const useBundledWorker = executable && !options.python && !process.env.SKILLFORGE_SPEECH_PYTHON && !process.env.SKILLFORGE_SPEECH_RUNTIME;
  return {
    workerExecutable: useBundledWorker ? path.join(resources, 'speech-runtime', process.platform === 'win32' ? 'skillforge-speech.exe' : 'skillforge-speech') : undefined,
    python: options.python || process.env.SKILLFORGE_SPEECH_PYTHON || path.join(runtime, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    worker: path.join(root, 'services/speech-worker.py'),
    model: path.join(modelRoot, 'base'),
    host: path.join(root, 'electron/playback-host.cjs')
  };
}

function terminate(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}

async function transcribePlayback(source, options = {}) {
  options.signal?.throwIfAborted();
  const runtime = runtimePaths(options);
  try {
    await Promise.all([...(runtime.workerExecutable ? [runtime.workerExecutable] : [runtime.python, runtime.worker]), ...['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'].map(name => path.join(runtime.model, name))].map(file => access(file)));
  } catch {
    throw new Error('SkillForge 离线语音环境或内置模型缺失，请运行 npm run prepare:speech 和 npm run check:speech-model');
  }
  const application = applicationPaths();
  const electronModule = application.executable || require('electron');
  const executable = typeof electronModule === 'string' ? electronModule : process.execPath;
  const directory = await mkdtemp(path.join(tmpdir(), 'skillforge-playback-'));
  try {
    const requestPath = path.join(directory, 'request.json');
    await writeFile(requestPath, JSON.stringify({
      source, runtime, directory, language: options.language || 'auto'
    }), { mode: 0o600 });
    options.signal?.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(executable, [application.executable ? '--skillforge-playback' : runtime.host, '--request', requestPath], {
        env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
      });
      let buffer = '';
      let stderr = '';
      let failure;
      let result;
      const abort = () => { failure = options.signal.reason || new Error('任务已取消'); terminate(child); };
      const report = event => {
        try {
          if (event.event === 'transcript-segment') options.onTranscript?.(event.segment);
          if (event.event === 'progress') options.onProgress?.(event);
        } catch {}
      };
      const parseLine = line => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.event === 'error') failure = new Error(String(event.message));
        else if (event.event === 'result') result = event.result;
        else report(event);
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 32 * 1024 * 1024) {
          failure = new Error('播放识别输出超过限制');
          terminate(child);
          return;
        }
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) parseLine(line);
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.on('error', error => { failure = error; });
      child.on('close', (code, exitSignal) => {
        options.signal?.removeEventListener('abort', abort);
        if (buffer) parseLine(buffer);
        if (failure) reject(failure);
        else if (code !== 0 || !result) reject(new Error(stderr || `播放器未正常完成语音识别（退出码 ${code}，信号 ${exitSignal || '无'}）`));
        else if (!result.text?.trim()) reject(new Error('播放完成，但未识别到可用语音'));
        else resolve(result);
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

module.exports = { transcribePlayback, runtimePaths };
