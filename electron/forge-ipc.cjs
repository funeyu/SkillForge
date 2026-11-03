const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { AgentStore, terminal } = require('../services/agent-store.cjs');
const { readWebpage } = require('./read-webpage.cjs');

function registerForgeIpc({ ipcMain }) {
  const store = new AgentStore();
  const windows = new Set();
  const snapshots = new Map();
  const pageUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  let active;
  let stopped = false;

  function trusted(event) {
    return windows.has(event.sender) && !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === pageUrl;
  }

  function handle(channel, action) {
    ipcMain.handle(channel, async (event, value) => {
      if (!trusted(event)) return { ok: false, error: '不允许此页面调用锻造服务' };
      try { return { ok: true, value: await action(value) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
  }

  function broadcast(job) {
    for (const contents of windows) if (!contents.isDestroyed()) contents.send('forge:progress', job);
  }

  async function processJob(job) {
    const controller = new AbortController();
    active = { id: job.id, controller };
    try {
      store.update(job.id, { status: 'reading', message: '正在 Electron 中打开网页…' });
      if (terminal.has(store.read(job.id).status)) return;
      const source = await readWebpage(job.url, {
        signal: controller.signal,
        onProgress: update => {
          try { if (!terminal.has(store.read(job.id).status)) store.update(job.id, update); }
          catch (error) { console.warn('[SkillForge progress]', error.message); }
        }
      });
      store.capture(job.id, source);
    } catch (error) {
      if (!terminal.has(store.read(job.id).status)) store.update(job.id, { status: error.name === 'AbortError' ? 'cancelled' : 'error', message: error.message });
    } finally { active = undefined; }
  }

  function scan() {
    if (stopped) return;
    try {
      const jobs = store.jobs();
      for (const job of jobs) {
        const fingerprint = JSON.stringify(job);
        if (snapshots.get(job.id) !== fingerprint) { snapshots.set(job.id, fingerprint); broadcast(job); }
      }
      if (active && store.read(active.id).status === 'cancelled') active.controller.abort();
      if (!active) {
        const job = jobs.find(item => item.status === 'queued');
        if (job) void processJob(job).catch(error => console.error('[SkillForge agent]', error));
      }
    } catch (error) { console.error('[SkillForge agent]', error.message); }
  }

  for (const job of store.jobs()) {
    snapshots.set(job.id, JSON.stringify(job));
    if (['reading', 'login_required'].includes(job.status)) store.update(job.id, { status: 'queued', message: '重新打开未完成的网页读取任务' });
  }
  handle('forge:start', value => store.create(value?.url));
  handle('forge:jobs', () => store.jobs());
  handle('forge:skills', () => store.skills());
  handle('forge:cancel', id => store.cancel(id));
  const timer = setInterval(scan, 500);
  const attach = window => {
    const contents = window.webContents;
    windows.add(contents);
    contents.on('did-finish-load', () => {
      const latest = store.jobs().at(-1);
      if (latest) contents.send('forge:progress', latest);
      scan();
    });
    contents.once('destroyed', () => windows.delete(contents));
  };
  attach.stop = () => { stopped = true; clearInterval(timer); active?.controller.abort(); };
  return attach;
}

module.exports = { registerForgeIpc };
