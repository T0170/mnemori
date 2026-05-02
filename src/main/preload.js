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
    screenshot: () => ipcRenderer.invoke('recording:screenshot'),
  },
  recordings: {
    list: () => ipcRenderer.invoke('recordings:list'),
    search: (query) => ipcRenderer.invoke('recordings:search', query),
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
    transcribeBlob: (buf) => ipcRenderer.invoke('pipeline:transcribeBlob', buf),
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
    copyToClipboard: (text) => ipcRenderer.invoke('system:copyToClipboard', text),
    copyArtifactRich: (text, injected, screenshots) => ipcRenderer.invoke('system:copyArtifactRich', text, injected, screenshots),
    saveFile: (defaultName, content) => ipcRenderer.invoke('system:saveFile', defaultName, content),
    copyScreenshot: (filePath) => ipcRenderer.invoke('screenshot:copy', filePath),
    saveScreenshot: (filePath) => ipcRenderer.invoke('screenshot:save', filePath),
    saveArtifactBundle: (name, content, screenshots) => ipcRenderer.invoke('system:saveArtifactBundle', name, content, screenshots),
  },
  audit: {
    list: (limit) => ipcRenderer.invoke('audit:list', limit),
  },
  hotkey: {
    get: () => ipcRenderer.invoke('hotkey:get'),
    set: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
    clear: () => ipcRenderer.invoke('hotkey:clear'),
  },
  profile: {
    get: (key) => ipcRenderer.invoke('profile:get', key),
    set: (key, value) => ipcRenderer.invoke('profile:set', key, value),
    getAll: () => ipcRenderer.invoke('profile:getAll'),
    isComplete: () => ipcRenderer.invoke('profile:isComplete'),
  },
  concepts: {
    insights: () => ipcRenderer.invoke('concepts:insights'),
    extract: (recordingId) => ipcRenderer.invoke('concepts:extract', recordingId),
    backfill: () => ipcRenderer.invoke('concepts:backfill'),
    generateReadout: () => ipcRenderer.invoke('concepts:generateReadout'),
    readouts: () => ipcRenderer.invoke('concepts:readouts'),
  },
  goals: {
    list: () => ipcRenderer.invoke('goals:list'),
    create: (label, metric, direction) => ipcRenderer.invoke('goals:create', label, metric, direction),
    delete: (id) => ipcRenderer.invoke('goals:delete', id),
    history: (metric) => ipcRenderer.invoke('goals:history', metric),
    checkMilestones: () => ipcRenderer.invoke('goals:checkMilestones'),
  },
  storage: {
    getPath: () => ipcRenderer.invoke('settings:getStoragePath'),
    choosePath: () => ipcRenderer.invoke('settings:chooseStoragePath'),
    setPath: (p) => ipcRenderer.invoke('settings:setStoragePath', p),
  },
  auth: {
    signIn: () => ipcRenderer.invoke('auth:sign-in'),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
  },
});
