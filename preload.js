// The renderer never receives Node.js or Electron primitives directly.
// Storage and the read-only Codex bridge stay behind contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('deckStorage', {
  load: () => ipcRenderer.invoke('deck:load'),
  save: (json) => ipcRenderer.invoke('deck:save', json),
  dataPath: () => ipcRenderer.invoke('deck:data-path'),
});

contextBridge.exposeInMainWorld('deckCodex', {
  checkCodex: () => ipcRenderer.invoke('codex:check'),
  pickProjectDirectory: () => ipcRenderer.invoke('project:pick'),
  inspectProject: (rootPath) => ipcRenderer.invoke('project:inspect', rootPath),
  extractContext: (payload) => ipcRenderer.invoke('codex:extract-context', payload),
  generatePrompt: (payload) => ipcRenderer.invoke('codex:generate-prompt', payload),
  cancelRun: (runId) => ipcRenderer.invoke('codex:cancel', runId),
  onStarted: (callback) => subscribe('deck:codex-started', callback),
  onProgress: (callback) => subscribe('deck:codex-progress', callback),
});
