import { app, BrowserWindow, dialog, Menu, net, shell, type MenuItem } from 'electron';
import { checkForUpdates, projectUrl } from './updateService';

let checking = false;

async function showMessage(options: Electron.MessageBoxOptions) {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}

async function open(url: string) {
  try {
    await shell.openExternal(url);
  } catch {
    await showMessage({ type: 'warning', title: 'Droid Studio Lite', message: '无法打开浏览器，请手动访问：', detail: url });
  }
}

async function check(item: MenuItem) {
  if (checking) return;
  checking = true;
  item.enabled = false;
  item.label = '正在检测更新…';
  try {
    const result = await checkForUpdates(app.getVersion(), net.fetch);
    if (result?.isUpdateAvailable) {
      const answer = await showMessage({
        type: 'info', title: '检测更新',
        message: `发现新版本 ${result.tag}（当前 ${result.currentVersion}）。`,
        detail: '是否前往 GitHub 发布页下载？', buttons: ['前往下载', '稍后'], defaultId: 0, cancelId: 1
      });
      if (answer.response === 0) await open(result.releaseUrl);
    } else {
      await showMessage({ type: 'info', title: '检测更新', message: result ?
        `当前已是最新版本（${result.currentVersion}）。` : '暂时没有可用的正式发布版。' });
    }
  } catch {
    await showMessage({ type: 'warning', title: '检测更新', message: '无法检测更新，请检查网络连接后重试。',
      detail: 'GitHub 暂时不可用或请求次数受限时也可能出现此提示。' });
  } finally {
    checking = false;
    item.enabled = true;
    item.label = '检测更新';
  }
}

export function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '文件', submenu: [{ role: 'close' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { label: '帮助', submenu: [
      { label: '使用说明', click: () => { void open(`${projectUrl}#readme`); } },
      { label: '检测更新', click: (item) => { void check(item); } },
      { label: '关于', click: () => { void showMessage({ type: 'info', title: '关于 Droid Studio Lite',
        message: `Droid Studio Lite ${app.getVersion()}`, detail: projectUrl }); } }
    ] }
  ]));
}
