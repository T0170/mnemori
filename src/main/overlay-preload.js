const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  stop: () => ipcRenderer.invoke('recording:stop'),
  screenshot: () => ipcRenderer.invoke('recording:screenshot'),
  getStatus: () => ipcRenderer.invoke('recording:status'),
  onStarted: (cb) => {
    const handler = (_e, startedAt) => cb(startedAt);
    ipcRenderer.on('overlay:started', handler);
    return () => ipcRenderer.removeListener('overlay:started', handler);
  },
  onStopped: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('overlay:stopped', handler);
    return () => ipcRenderer.removeListener('overlay:stopped', handler);
  },
  onScreenshotCaptured: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('overlay:screenshotCaptured', handler);
    return () => ipcRenderer.removeListener('overlay:screenshotCaptured', handler);
  },
});
