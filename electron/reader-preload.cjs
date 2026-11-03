const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('skillforgeReader', Object.freeze({
  read: () => ipcRenderer.send('reader:action', 'read'),
  cancel: () => ipcRenderer.send('reader:action', 'cancel'),
  onStatus: callback => ipcRenderer.on('reader:status', (_event, value) => callback(value))
}));
