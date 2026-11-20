import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

const api = {
  adbStatus: () => ipcRenderer.invoke('adb:status'),
  setAdbPath: (adbPath: string) => ipcRenderer.invoke('adb:setPath', adbPath),
  pickAdbFile: () => ipcRenderer.invoke('adb:pick'),

  listDevices: () => ipcRenderer.invoke('devices:list'),
  onDevices: (callback: (devices: unknown[]) => void): Unsubscribe => {
    const handler = (_event: unknown, devices: unknown[]) => callback(devices);
    ipcRenderer.on('devices:changed', handler);
    return () => ipcRenderer.off('devices:changed', handler);
  },

  startLogcat: (options: { serial: string; buffers: string[] }) =>
    ipcRenderer.invoke('logcat:start', options),
  stopLogcat: () => ipcRenderer.invoke('logcat:stop'),
  clearLogcat: (serial: string) => ipcRenderer.invoke('logcat:clear', serial),
  onLogcatBatch: (callback: (batch: unknown[]) => void): Unsubscribe => {
    const handler = (_event: unknown, batch: unknown[]) => callback(batch);
    ipcRenderer.on('logcat:batch', handler);
    return () => ipcRenderer.off('logcat:batch', handler);
  },
  onLogcatStatus: (callback: (state: string, detail?: string) => void): Unsubscribe => {
    const handler = (_event: unknown, state: string, detail?: string) => callback(state, detail);
    ipcRenderer.on('logcat:status', handler);
    return () => ipcRenderer.off('logcat:status', handler);
  },

  fsList: (serial: string, dir: string) => ipcRenderer.invoke('fs:list', serial, dir),
  fsReadText: (serial: string, target: string) =>
    ipcRenderer.invoke('fs:readText', serial, target),
  fsWriteText: (serial: string, target: string, content: string) =>
    ipcRenderer.invoke('fs:writeText', serial, target, content),
  fsDelete: (serial: string, paths: string[]) => ipcRenderer.invoke('fs:delete', serial, paths),
  fsMkdir: (serial: string, dir: string) => ipcRenderer.invoke('fs:mkdir', serial, dir),
  fsPull: (serial: string, remote: string) => ipcRenderer.invoke('fs:pull', serial, remote),
  fsPush: (serial: string, remoteDir: string) => ipcRenderer.invoke('fs:push', serial, remoteDir),

  openLocalText: () => ipcRenderer.invoke('local:open'),
  readLocalText: (filePath: string) => ipcRenderer.invoke('local:read', filePath),
  saveLocalText: (filePath: string, content: string) =>
    ipcRenderer.invoke('local:save', filePath, content),
  saveLocalTextAs: (content: string, suggested: string) =>
    ipcRenderer.invoke('local:saveAs', content, suggested),
  revealInExplorer: (filePath: string) => ipcRenderer.invoke('local:reveal', filePath),

  exportLog: (content: string, suggested: string) =>
    ipcRenderer.invoke('log:export', content, suggested),

  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text)
};

contextBridge.exposeInMainWorld('api', api);

export type MainApi = typeof api;
