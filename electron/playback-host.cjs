const { app, BrowserWindow, ipcMain, protocol, session, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const { readFileSync, mkdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mediaResponse } = require('../services/playback-media.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'skillforge-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let player;
let worker;
let stopped = false;
let finishRequested = false;
let completed = false;
let acknowledge;
const segments = [];
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');

function stop(error) {
  if (stopped) return;
  stopped = true;
  if (error) emit({ event: 'error', message: error.message });
  if (acknowledge) acknowledge.reject(error || new Error('播放已结束'));
  worker?.kill('SIGKILL');
  app.exit(error ? 1 : 0);
}

async function main() {
  const requestPath = process.argv[process.argv.indexOf('--request') + 1];
  const request = JSON.parse(readFileSync(requestPath, 'utf8'));
  mkdirSync(path.join(request.directory, 'electron'), { recursive: true });
  app.setPath('userData', path.join(request.directory, 'electron'));
  app.name = 'SkillForge 语音识别';
  await app.whenReady();
  nativeTheme.themeSource = 'dark';
  emit({ event: 'progress', stage: 'loading', message: '正在加载 SkillForge 内置离线模型' });
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  worker = spawn(request.runtime.workerExecutable || request.runtime.python, [...(request.runtime.workerExecutable ? [] : [request.runtime.worker]), '--model', request.runtime.model, '--language', request.language], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' }
  });
  let buffer = '';
  let stderr = '';
  worker.stdout.setEncoding('utf8');
  worker.stderr.setEncoding('utf8');
  worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  worker.stdin.on('error', error => stop(error));
  worker.on('error', error => { readyReject(error); stop(error); });
  worker.on('close', code => {
    if (!stopped && !completed) stop(new Error(`离线识别进程异常退出（${code}）：${stderr}`));
  });
  worker.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) return stop(new Error('语音处理器输出超限'));
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.event === 'ready') readyResolve();
      if (event.event === 'error') { readyReject(new Error(event.message)); stop(new Error(event.message)); }
      if (event.event === 'transcript-segment') {
        const segment = event.segment;
        if (!segment || typeof segment.text !== 'string' || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segments.length >= 50000) {
          return stop(new Error('语音识别分段格式无效或超过限制'));
        }
        segments.push(segment);
        emit(event);
        if (player && !player.isDestroyed()) player.webContents.send('speech:segment', segment);
      }
      if (event.event === 'chunk-complete' && acknowledge?.id === event.id) {
        const pending = acknowledge;
        acknowledge = undefined;
        pending.resolve();
      }
      if (event.event === 'done' && finishRequested) {
        completed = true;
        process.stdout.write(JSON.stringify({ event: 'result', result: { text: segments.map(segment => segment.text).join('\n'), segments, warnings: [] } }) + '\n', () => stop());
      }
    }
  });

  const partition = session.fromPartition('speech-' + randomUUID());
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  const mediaUrl = 'skillforge-media://playback/' + randomUUID();
  partition.protocol.handle('skillforge-media', async incoming => {
    if (incoming.url !== mediaUrl) return new Response(null, { status: 404 });
    try { return await mediaResponse(request.source, incoming); }
    catch (error) {
      if (!incoming.signal.aborted) stop(error);
      return new Response(null, { status: 502 });
    }
  });
  player = new BrowserWindow({
    width: 900, height: 720, minWidth: 600, minHeight: 540,
    title: 'SkillForge · 边播放边识别', backgroundColor: '#0a0a0b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'playback-preload.cjs'), session: partition,
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      backgroundThrottling: false
    }
  });
  player.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  player.webContents.on('will-navigate', event => event.preventDefault());
  player.webContents.on('will-attach-webview', event => event.preventDefault());
  player.webContents.on('render-process-gone', () => stop(new Error('播放窗口异常退出')));
  player.on('close', () => stop(new Error('播放窗口已关闭，识别已取消')));
  const pageUrl = pathToFileURL(path.join(__dirname, 'playback.html')).href;
  function authorize(event) {
    if (stopped || event.sender !== player.webContents || event.senderFrame !== player.webContents.mainFrame || event.senderFrame.url !== pageUrl) {
      throw new Error('不允许的播放请求');
    }
  }
  let started = false;
  let chunkId = 0;
  let previousEnd = 0;
  ipcMain.handle('speech:start', async event => {
    authorize(event);
    if (started) throw new Error('播放已经开始');
    started = true;
    await ready;
    emit({ event: 'progress', stage: 'playing', message: '模型已就绪，正在边播放边识别（约 4 秒分块）' });
    return { url: mediaUrl };
  });
  ipcMain.handle('speech:audio', async (event, payload) => {
    authorize(event);
    if (!started || finishRequested || acknowledge || !payload || !ArrayBuffer.isView(payload.pcm) ||
        !payload.pcm.byteLength || payload.pcm.byteLength > 256000 || payload.pcm.byteLength % 4 ||
        !Number.isFinite(payload.start) || payload.start < Math.max(0, previousEnd - 0.15)) throw new Error('播放音频分块无效');
    const pcm = Buffer.from(payload.pcm.buffer, payload.pcm.byteOffset, payload.pcm.byteLength);
    previousEnd = payload.start + pcm.byteLength / 64000;
    const id = chunkId++;
    const completion = new Promise((resolve, reject) => { acknowledge = { id, resolve, reject }; });
    worker.stdin.write(JSON.stringify({ event: 'audio', id, start: payload.start, pcm: pcm.toString('base64') }) + '\n');
    await completion;
  });
  ipcMain.handle('speech:finish', event => {
    authorize(event);
    if (!started || acknowledge || finishRequested) throw new Error('音频处理尚未完成');
    finishRequested = true;
    emit({ event: 'progress', stage: 'finishing', message: '播放结束，已完成最后一个音频分块' });
    worker.stdin.end(JSON.stringify({ event: 'finish' }) + '\n');
  });
  ipcMain.handle('speech:error', (event, message) => { authorize(event); stop(new Error(String(message).slice(0, 1000))); });
  await player.loadURL(pageUrl);
}

process.on('SIGTERM', () => stop(new Error('任务已取消')));
process.on('SIGINT', () => stop(new Error('任务已取消')));
main().catch(stop);
