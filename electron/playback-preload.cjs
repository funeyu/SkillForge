const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('speechPlayback', {
  start: () => ipcRenderer.invoke('speech:start'),
  audio: (start, samples) => ipcRenderer.invoke('speech:audio', { start, pcm: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength) }),
  finish: () => ipcRenderer.invoke('speech:finish'),
  error: message => ipcRenderer.invoke('speech:error', String(message)),
  onSegment: callback => ipcRenderer.on('speech:segment', (_event, segment) => callback(segment))
});
