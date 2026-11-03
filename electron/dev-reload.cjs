const { watchFile, unwatchFile } = require('node:fs');
const path = require('node:path');

module.exports = function startDevReload({ app, BrowserWindow, root }) {
  const files = [
    ['styles.css', 1],
    ['index.html', 2],
    ['forge-3d.js', 2],
    ['toolbox.js', 2],
    ['intake.js', 2],
    ['pressure.js', 3],
    ['electron/preload.cjs', 3],
    ['electron/forge-ipc.cjs', 3],
    ['electron/read-webpage.cjs', 3],
    ['electron/reader-preload.cjs', 3],
    ['electron/reader.html', 3],
    ['electron/reader.js', 3],
    ['electron/reader.css', 3],
    ['services/agent-store.cjs', 3],
    ['services/browser-snapshot.cjs', 3],
    ['services/index.cjs', 3],
    ['services/analyze.cjs', 3],
    ['electron/main.cjs', 3],
    ['electron/dev-reload.cjs', 3]
  ];
  const subscriptions = [];
  let pending = 0;
  let timer;
  let updating = false;
  let stopped = false;

  async function update() {
    if (stopped || updating || !pending) return;
    const action = pending;
    pending = 0;
    updating = true;
    try {
      await Promise.all(BrowserWindow.getAllWindows().map(async (window) => {
        const contents = window.webContents;
        if (contents.isDestroyed()) return;
        if (action === 1) {
          await contents.executeJavaScript(`(() => {
            const stylesheet = document.querySelector('link[rel="stylesheet"]');
            if (!stylesheet) return;
            const url = new URL(stylesheet.href);
            url.searchParams.set('dev', Date.now().toString());
            stylesheet.href = url.href;
          })()`);
        } else if (action === 2 && !contents.isDestroyed()) {
          contents.reloadIgnoringCache();
        }
      }));
      if (action === 3 && !stopped) {
        app.relaunch();
        app.quit();
      }
    } catch (error) {
      console.warn('[SkillForge dev] 更新失败：', error.message);
    } finally {
      updating = false;
      if (pending && !stopped) timer = setTimeout(update, 150);
    }
  }

  for (const [filename, action] of files) {
    const filepath = path.join(root, filename);
    const listener = (current, previous) => {
      if (stopped || !current.nlink) return;
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      pending = Math.max(pending, action);
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    };
    watchFile(filepath, { interval: 300, persistent: false }, listener);
    subscriptions.push([filepath, listener]);
  }

  app.once('will-quit', () => {
    stopped = true;
    clearTimeout(timer);
    for (const [filepath, listener] of subscriptions) unwatchFile(filepath, listener);
  });
  console.log('[SkillForge dev] 热更新已开启');
};
