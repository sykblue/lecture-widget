const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  close: () => ipcRenderer.invoke('win:close'),
  collapse: (on) => ipcRenderer.invoke('win:collapse', on),
  pin: (on) => ipcRenderer.invoke('win:pin', on),
  platform: () => ipcRenderer.invoke('platform'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  ollamaModels: () => ipcRenderer.invoke('ollama:models'),
  summarize: (payload) => ipcRenderer.invoke('summary:run', payload),
  onSummaryDelta: (cb) => ipcRenderer.on('summary:delta', (_e, d) => cb(d)),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
});
