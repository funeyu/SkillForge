const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skillforge', Object.freeze({
  jobs: () => ipcRenderer.invoke('forge:jobs'),
  listSkills: () => ipcRenderer.invoke('forge:skills'),
  start: value => ipcRenderer.invoke('forge:start', value),
  cancel: requestId => ipcRenderer.invoke('forge:cancel', requestId),
  onProgress: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('forge:progress', listener);
    return () => ipcRenderer.removeListener('forge:progress', listener);
  }
}));
