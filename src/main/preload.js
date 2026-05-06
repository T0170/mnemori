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
    generate: (id, mode, customPromptId) => ipcRenderer.invoke('pipeline:generate', id, mode, customPromptId),
    generateAll: (id, modes) => ipcRenderer.invoke('pipeline:generateAll', id, modes),
    transcribeBlob: (buf) => ipcRenderer.invoke('pipeline:transcribeBlob', buf),
    onProgress: (callback) => {
      const listener = (_evt, data) => callback(data);
      ipcRenderer.on('pipeline:progress', listener);
      return () => ipcRenderer.removeListener('pipeline:progress', listener);
    },
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
    update: (id, updates) => ipcRenderer.invoke('projects:update', id, updates),
    remove: (id) => ipcRenderer.invoke('projects:delete', id),
    generateSummary: (id) => ipcRenderer.invoke('projects:generateSummary', id),
  },
  decay: {
    list: () => ipcRenderer.invoke('decay:list'),
    listForRecording: (recordingId) => ipcRenderer.invoke('decay:listForRecording', recordingId),
    dismiss: (alertId) => ipcRenderer.invoke('decay:dismiss', alertId),
    update: (alertId) => ipcRenderer.invoke('decay:update', alertId),
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
    verify: () => ipcRenderer.invoke('audit:verify'),
  },
  encryption: {
    status: () => ipcRenderer.invoke('encryption:status'),
    enable: () => ipcRenderer.invoke('encryption:enable'),
    disable: () => ipcRenderer.invoke('encryption:disable'),
    onProgress: (callback) => {
      const listener = (_evt, data) => callback(data);
      ipcRenderer.on('encryption:progress', listener);
      return () => ipcRenderer.removeListener('encryption:progress', listener);
    },
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
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    create: (name, promptText) => ipcRenderer.invoke('prompts:create', name, promptText),
    update: (id, name, promptText) => ipcRenderer.invoke('prompts:update', id, name, promptText),
    remove: (id) => ipcRenderer.invoke('prompts:delete', id),
    setDefault: (id) => ipcRenderer.invoke('prompts:setDefault', id),
  },
  auth: {
    signIn: () => ipcRenderer.invoke('auth:sign-in'),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
  },
  updater: {
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    onUpdateAvailable: (callback) => {
      const listener = (_evt, version) => callback(version);
      ipcRenderer.on('update:available', listener);
      return () => ipcRenderer.removeListener('update:available', listener);
    },
    onUpdateDownloaded: (callback) => {
      const listener = (_evt, version) => callback(version);
      ipcRenderer.on('update:downloaded', listener);
      return () => ipcRenderer.removeListener('update:downloaded', listener);
    },
  },
});
