import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  adbVersion,
  listDevices,
  resolveAdb,
  setAdbPath,
  adbExec,
  type DeviceInfo
} from './adb';
import { LogcatSession } from './logcat';
import {
  listDir,
  pullRemote,
  pushLocal,
  readRemoteText,
  removeRemote,
  makeDir,
  writeRemoteText
} from './deviceFs';

const userDataDir = app.getPath('userData');
let mainWindow: BrowserWindow | null = null;
let logcat: LogcatSession | null = null;
let deviceTimer: NodeJS.Timeout | null = null;
let lastDeviceKey = '';

function broadcastDevices(devices: DeviceInfo[]) {
  const key = devices.map((d) => `${d.serial}:${d.state}`).join('|');
  if (key === lastDeviceKey) return;
  lastDeviceKey = key;
  mainWindow?.webContents.send('devices:changed', devices);
}

async function pollDevices() {
  try {
    const devices = await listDevices(userDataDir);
    broadcastDevices(devices);
  } catch {
    broadcastDevices([]);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 640,
    backgroundColor: '#1e1f22',
    title: 'Droid Studio Lite',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!deviceTimer) {
    deviceTimer = setInterval(() => void pollDevices(), 2500);
  }

  if (process.env.DSL_CAPTURE) {
    const target = process.env.DSL_CAPTURE;
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const image = await mainWindow.webContents.capturePage();
            await writeFile(target, image.toPNG());
          }
        } finally {
          app.quit();
        }
      }, 5000);
    });
  }
}

function registerIpc() {
  ipcMain.handle('adb:status', async () => {
    const binPath = resolveAdb(userDataDir);
    const version = await adbVersion(userDataDir);
    return { adbPath: binPath, version, ok: Boolean(binPath) };
  });

  ipcMain.handle('adb:setPath', async (_event, adbPath: string) => {
    setAdbPath(userDataDir, adbPath);
    const version = await adbVersion(userDataDir);
    lastDeviceKey = '';
    await pollDevices();
    return { adbPath, version, ok: Boolean(version) };
  });

  ipcMain.handle('adb:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 adb 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'adb', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    setAdbPath(userDataDir, result.filePaths[0]);
    const version = await adbVersion(userDataDir);
    lastDeviceKey = '';
    await pollDevices();
    return { adbPath: result.filePaths[0], version, ok: Boolean(version) };
  });

  ipcMain.handle('devices:list', async () => {
    try {
      return await listDevices(userDataDir);
    } catch {
      return [];
    }
  });

  ipcMain.handle('logcat:start', async (event, options: { serial: string; buffers: string[] }) => {
    if (!logcat) {
      logcat = new LogcatSession(
        userDataDir,
        (batch) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          mainWindow.webContents.send('logcat:batch', batch);
        },
        (state, detail) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          mainWindow.webContents.send('logcat:status', state, detail);
        }
      );
    }
    logcat.stop();
    logcat.start(options);
    return { ok: true };
  });

  ipcMain.handle('logcat:stop', async () => {
    logcat?.stop();
    return { ok: true };
  });

  ipcMain.handle('logcat:clear', async (_event, serial: string) => {
    const result = await adbExec(userDataDir, ['logcat', '-c'], serial, 10000);
    return { ok: result.code === 0, detail: result.stderr.trim() };
  });

  ipcMain.handle('fs:list', async (_event, serial: string, dir: string) =>
    listDir(userDataDir, serial, dir)
  );

  ipcMain.handle('fs:readText', async (_event, serial: string, target: string) =>
    readRemoteText(userDataDir, serial, target)
  );

  ipcMain.handle(
    'fs:writeText',
    async (_event, serial: string, target: string, content: string) => {
      await writeRemoteText(userDataDir, serial, target, content);
      return { ok: true };
    }
  );

  ipcMain.handle('fs:delete', async (_event, serial: string, paths: string[]) => {
    await removeRemote(userDataDir, serial, paths);
    return { ok: true };
  });

  ipcMain.handle('fs:mkdir', async (_event, serial: string, dir: string) => {
    await makeDir(userDataDir, serial, dir);
    return { ok: true };
  });

  ipcMain.handle('fs:pull', async (_event, serial: string, remote: string) => {
    const result = await dialog.showOpenDialog({
      title: '选择保存目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const output = await pullRemote(userDataDir, serial, remote, result.filePaths[0]);
    return { ok: true, output, localDir: result.filePaths[0] };
  });

  ipcMain.handle('fs:push', async (_event, serial: string, remoteDir: string) => {
    const result = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const output = await pushLocal(userDataDir, serial, result.filePaths, remoteDir);
    return { ok: true, output };
  });

  ipcMain.handle('local:open', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开文件',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const files = [];
    for (const filePath of result.filePaths) {
      const stat = await readFile(filePath).catch(() => null);
      if (!stat) continue;
      if (stat.includes(0)) continue;
      if (stat.byteLength > 8 * 1024 * 1024) continue;
      files.push({ path: filePath, name: path.basename(filePath), content: stat.toString('utf8') });
    }
    return { ok: true, files };
  });

  ipcMain.handle('local:read', async (_event, filePath: string) => {
    const buffer = readFileSync(filePath);
    if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('文件超过 8 MB');
    if (buffer.includes(0)) throw new Error('二进制文件不可编辑');
    return buffer.toString('utf8');
  });

  ipcMain.handle('local:save', async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf8');
    return { ok: true };
  });

  ipcMain.handle('local:saveAs', async (_event, content: string, suggested: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: suggested });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeFile(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle('local:reveal', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('log:export', async (_event, content: string, suggested: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: suggested });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeFile(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  void pollDevices();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logcat?.stop();
  if (deviceTimer) {
    clearInterval(deviceTimer);
    deviceTimer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
