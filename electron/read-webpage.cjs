const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const { webUrl } = require('../services/agent-store.cjs');
const { browserSnapshot } = require('../services/browser-snapshot.cjs');

function readWebpage(url, { signal, onProgress }) {
  webUrl(url);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const partition = 'persist:skillforge-reader';
    const browsingSession = session.fromPartition(partition);
    browsingSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browsingSession.setPermissionCheckHandler(() => false);
    const denyDownload = event => event.preventDefault();
    browsingSession.on('will-download', denyDownload);
    const controlsUrl = pathToFileURL(path.join(__dirname, 'reader.html')).href;
    const window = new BrowserWindow({
      width: 1100, height: 800, minWidth: 720, minHeight: 500, title: 'SkillForge · 网页资料',
      webPreferences: { preload: path.join(__dirname, 'reader-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    const view = new WebContentsView({ webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    const popups = new Set();
    window.contentView.addChildView(view);
    let finished = false;
    let waitingForUser = false;
    let reading = false;
    let currentMessage = '正在打开网页并读取正文…';
    let timer;

    function resize() {
      const bounds = window.getContentBounds();
      view.setBounds({ x: 0, y: 112, width: bounds.width, height: Math.max(1, bounds.height - 112) });
    }

    function update(message, status = 'reading') {
      if (finished) return;
      currentMessage = message;
      onProgress({ status, message });
      if (!window.webContents.isDestroyed()) window.webContents.send('reader:status', { message, url, waitingForUser });
    }

    function finish(error, source) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      ipcMain.removeListener('reader:action', action);
      browsingSession.removeListener('will-download', denyDownload);
      for (const popup of popups) if (!popup.isDestroyed()) popup.destroy();
      if (!view.webContents.isDestroyed()) view.webContents.close();
      if (!window.isDestroyed()) window.destroy();
      if (error) reject(error); else resolve(source);
    }

    function abort() { finish(new DOMException('已取消网页读取', 'AbortError')); }

    function secure(contents) {
      for (const name of ['will-navigate', 'will-redirect']) contents.on(name, (event, address) => {
        try { webUrl(address); } catch { event.preventDefault(); }
      });
      contents.on('will-attach-webview', event => event.preventDefault());
      contents.setWindowOpenHandler(({ url: address }) => {
        if (finished || popups.size >= 2) return { action: 'deny' };
        try { webUrl(address); }
        catch { return { action: 'deny' }; }
        return { action: 'allow', overrideBrowserWindowOptions: { parent: window, webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, preload: undefined } } };
      });
      contents.on('did-create-window', popup => { popups.add(popup); popup.once('closed', () => popups.delete(popup)); secure(popup.webContents); });
    }

    async function capture() {
      if (finished || reading || waitingForUser || view.webContents.isLoadingMainFrame()) return;
      reading = true;
      try {
        const source = await view.webContents.executeJavaScript(`(${browserSnapshot.toString()})()`, false);
        if (finished) return;
        webUrl(source.url);
        if (source.authRequired || source.text.trim().length < 80) {
          waitingForUser = true;
          update(source.authRequired ? '此网页需要登录或验证。请在下方自行完成，然后点击「登录完成，重新读取」。' : '正文尚未就绪。请检查网页是否需要登录或等待加载，再点击「重新读取」。', 'login_required');
          return;
        }
        finish(null, source);
      } catch (error) {
        if (finished) return;
        waitingForUser = true;
        update(`暂时无法读取：${error.message}。请检查网页后重试。`, 'login_required');
      } finally { reading = false; }
    }

    function action(event, value) {
      if (finished || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== controlsUrl) return;
      if (value === 'cancel') return abort();
      if (value !== 'read' || reading) return;
      waitingForUser = false;
      update('正在重新读取用户指定的原网页…');
      view.webContents.loadURL(url).catch(error => { waitingForUser = true; update(error.message, 'login_required'); });
    }

    secure(view.webContents);
    ipcMain.on('reader:action', action);
    window.on('resize', resize);
    window.on('closed', () => { if (!finished) abort(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.once('did-finish-load', () => update(currentMessage, waitingForUser ? 'login_required' : 'reading'));
    view.webContents.on('did-finish-load', () => void capture());
    view.webContents.on('render-process-gone', () => finish(new Error('网页渲染进程已退出，请重新读取')));
    view.webContents.on('did-fail-load', (_event, code, description, _address, isMainFrame) => {
      if (!isMainFrame || code === -3 || finished) return;
      waitingForUser = true;
      update(`网页加载失败：${description}。请重试或取消。`, 'login_required');
    });
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('网页读取等待超过 10 分钟，请重新创建任务')), 10 * 60 * 1000);
    resize();
    window.loadFile(path.join(__dirname, 'reader.html')).catch(error => finish(error));
    view.webContents.loadURL(url).catch(error => { waitingForUser = true; update(`网页加载失败：${error.message}`, 'login_required'); });
  });
}

module.exports = { readWebpage };
