/**
 * Preload script: bridges the secure renderer to the main process via contextBridge.
 * Everything the React UI can do touches the OS goes through here.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  recording: {
    start: (options) => ipcRenderer.invoke('recording:start', options),
    stop: () => ipcRenderer.invoke('recording:stop'),
    status: () => ipcRenderer.invoke('recording:status'),
  },
  recordings: {
    list: () => ipcRenderer.invoke('recordings:list'),
    get: (id) => ipcRenderer.invoke('recordings:get', id),
    update: (id, updates) => ipcRenderer.invoke('recordings:update', id, updates),
    remove: (id) => ipcRenderer.invoke('recordings:delete', id),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('recordings:changed', listener);
      return () => ipcRenderer.removeListener('recordings:changed', listener);
    },
  },
  pipeline: {
    transcribe: (id) => ipcRenderer.invoke('pipeline:transcribe', id),
    generate: (id, mode) => ipcRenderer.invoke('pipeline:generate', id, mode),
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    listAudioDevices: () => ipcRenderer.invoke('settings:listAudioDevices'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name, description) => ipcRenderer.invoke('projects:create', name, description),
    get: (id) => ipcRenderer.invoke('projects:get', id),
    remove: (id) => ipcRenderer.invoke('projects:delete', id),
    generateSummary: (id) => ipcRenderer.invoke('projects:generateSummary', id),
  },
  system: {
    openPath: (p) => ipcRenderer.invoke('system:openPath', p),
    showItemInFolder: (p) => ipcRenderer.invoke('system:showItemInFolder', p),
  },
});
