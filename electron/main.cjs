const { app, BrowserWindow, Menu, session, nativeTheme, ipcMain } = require('electron');
const path = require('node:path');
const { registerForgeIpc } = require('./forge-ipc.cjs');
let attachForge;
let workbench;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

function createWindow() {
  const window = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 860,
    minHeight: 700,
    title: 'SkillForge',
    backgroundColor: '#0a0a0b',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 23, y: 23 },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  workbench = window;

  attachForge(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, '..', 'index.html'));
}

if (ownsInstance) app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  attachForge = registerForgeIpc({ ipcMain });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]));
  createWindow();
  if (!app.isPackaged && process.argv.includes('--dev')) {
    require('./dev-reload.cjs')({ app, BrowserWindow, root: path.join(__dirname, '..') });
  }
  app.on('activate', () => {
    if (!workbench || workbench.isDestroyed()) createWindow();
  });
}).catch(error => { console.error('[SkillForge startup]', error); app.exit(1); });

app.on('second-instance', () => {
  if (!attachForge) return;
  if (!workbench || workbench.isDestroyed()) createWindow();
  if (workbench.isMinimized()) workbench.restore();
  workbench.show();
  workbench.focus();
});
app.on('before-quit', () => attachForge?.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
