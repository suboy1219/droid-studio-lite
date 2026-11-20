import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import DeviceExplorer from './components/DeviceExplorer';
import LogcatPanel from './components/LogcatPanel';
import EditorPane from './components/EditorPane';
import type { AdbStatus, DeviceInfo, EditorTab, LogEntry, LogcatState, RemoteEntry } from './types';

const MAX_LINES = 30000;

const errText = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? '未知错误');

export default function App() {
  const [adb, setAdb] = useState<AdbStatus | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [serial, setSerial] = useState('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [logState, setLogState] = useState<LogcatState>('idle');
  const [logDetail, setLogDetail] = useState('');
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(330);
  const [logHeight, setLogHeight] = useState(300);
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [logVisible, setLogVisible] = useState(true);
  const [jumpPath, setJumpPath] = useState<string | null>(null);

  const toastTimer = useRef<number | null>(null);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    let alive = true;
    window.api.adbStatus().then((status) => {
      if (alive) setAdb(status);
    });
    window.api.listDevices().then((list) => {
      if (alive) setDevices(list);
    });
    const offDevices = window.api.onDevices((list) => setDevices(list));
    const offBatch = window.api.onLogcatBatch((batch) => {
      setEntries((prev) => {
        if (!batch.length) return prev;
        const next = prev.concat(batch);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
    const offStatus = window.api.onLogcatStatus((state, detail) => {
      setLogState(state as LogcatState);
      setLogDetail(detail ?? '');
    });
    return () => {
      alive = false;
      offDevices();
      offBatch();
      offStatus();
    };
  }, []);

  useEffect(() => {
    if (!devices.length) {
      if (serial) setSerial('');
      return;
    }
    const stillThere = devices.some((device) => device.serial === serial);
    if (!stillThere) {
      const first = devices.find((device) => device.state === 'device') ?? devices[0];
      setSerial(first.serial);
    }
  }, [devices, serial]);

  useEffect(() => {
    if (!serial) {
      setLogState('idle');
      setEntries([]);
      return;
    }
    setEntries([]);
    setLogDetail('');
    setLogState('running');
    window.api.startLogcat({ serial, buffers: ['main', 'system', 'crash'] }).catch((error) => {
      setLogState('error');
      setLogDetail(errText(error));
    });
  }, [serial]);

  const restartLogcat = useCallback(async () => {
    if (!serial) return;
    setEntries([]);
    try {
      await window.api.startLogcat({ serial, buffers: ['main', 'system', 'crash'] });
      setLogState('running');
    } catch (error) {
      notify(errText(error));
    }
  }, [serial, notify]);

  const stopLogcat = useCallback(async () => {
    await window.api.stopLogcat();
    setLogState('stopped');
  }, []);

  const clearLogcat = useCallback(async () => {
    setEntries([]);
    if (!serial) return;
    const result = await window.api.clearLogcat(serial);
    if (!result.ok) notify(result.detail || '清空设备日志失败');
  }, [serial, notify]);

  const exportLogs = useCallback(
    async (lines: LogEntry[]) => {
      const text = lines
        .map(
          (entry) =>
            `${entry.date} ${entry.time} ${String(entry.pid).padStart(5)} ${String(
              entry.tid
            ).padStart(5)} ${entry.level} ${entry.tag}: ${entry.message}`
        )
        .join('\n');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const result = await window.api.exportLog(text, `logcat-${stamp}.txt`);
      if (result.ok) notify(`已导出到 ${result.path}`);
    },
    [notify]
  );

  const openRemoteFile = useCallback(
    async (entry: RemoteEntry) => {
      if (entry.isDir || !serial) return;
      const existing = tabs.find(
        (tab) => tab.kind === 'remote' && tab.serial === serial && tab.path === entry.path
      );
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      try {
        const content = await window.api.fsReadText(serial, entry.path);
        const tab: EditorTab = {
          id: crypto.randomUUID(),
          kind: 'remote',
          path: entry.path,
          name: entry.name,
          content,
          dirty: false,
          serial
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      } catch (error) {
        notify(errText(error));
      }
    },
    [tabs, serial, notify]
  );

  const openLocalFiles = useCallback(async () => {
    try {
      const result = await window.api.openLocalText();
      if (!result.ok || !result.files?.length) return;
      const incoming = result.files.map<EditorTab>((file) => ({
        id: crypto.randomUUID(),
        kind: 'local',
        path: file.path,
        name: file.name,
        content: file.content,
        dirty: false
      }));
      for (const tab of incoming) {
        const existing = tabs.find((item) => item.kind === 'local' && item.path === tab.path);
        if (existing) {
          setActiveTabId(existing.id);
          continue;
        }
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      }
    } catch (error) {
      notify(errText(error));
    }
  }, [tabs, notify]);

  const updateContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, content, dirty: true } : tab))
    );
  }, []);

  const saveTab = useCallback(
    async (tab: EditorTab | null) => {
      if (!tab) return;
      try {
        if (tab.kind === 'remote' && tab.serial) {
          await window.api.fsWriteText(tab.serial, tab.path, tab.content);
        } else {
          await window.api.saveLocalText(tab.path, tab.content);
        }
        setTabs((prev) => prev.map((item) => (item.id === tab.id ? { ...item, dirty: false } : item)));
        notify(`已保存 ${tab.name}`);
      } catch (error) {
        notify(`保存失败：${errText(error)}`);
      }
    },
    [notify]
  );

  const saveActive = useCallback(() => {
    void saveTab(activeTab);
  }, [activeTab, saveTab]);

  const saveAs = useCallback(async () => {
    if (!activeTab) return;
    const result = await window.api.saveLocalTextAs(activeTab.content, activeTab.name);
    if (result.ok && result.path) {
      const fileName = result.path.split(/[\\/]/).pop() ?? activeTab.name;
      setTabs((prev) =>
        prev.map((item) =>
          item.id === activeTab.id
            ? { ...item, kind: 'local', path: result.path!, name: fileName, dirty: false }
            : item
        )
      );
      notify(`已另存为 ${result.path}`);
    }
  }, [activeTab, notify]);

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((item) => item.id === id);
      if (tab?.dirty && !window.confirm(`「${tab.name}」有未保存的修改，仍要关闭吗？`)) return;
      setTabs((prev) => prev.filter((item) => item.id !== id));
      if (activeTabId === id) {
        const rest = tabs.filter((item) => item.id !== id);
        setActiveTabId(rest.length ? rest[rest.length - 1].id : null);
      }
    },
    [tabs, activeTabId]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (event.shiftKey) void saveAs();
        else saveActive();
      }
      if (mod && event.key.toLowerCase() === 'w' && activeTabId) {
        event.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActive, saveAs, closeTab, activeTabId]);

  const chooseAdb = useCallback(async () => {
    try {
      const result = await window.api.pickAdbFile();
      if (result) {
        setAdb(result);
        notify(result.ok ? `adb 已切换：${result.version}` : '该路径下无法运行 adb');
      }
    } catch (error) {
      notify(errText(error));
    }
  }, [notify]);

  const startDrag = (
    kind: 'explorer' | 'log',
    event: ReactMouseEvent,
    container: HTMLElement | null
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const baseWidth = explorerWidth;
    const baseHeight = logHeight;
    const onMove = (moveEvent: MouseEvent) => {
      if (kind === 'explorer') {
        const next = Math.min(560, Math.max(220, baseWidth + (moveEvent.clientX - startX)));
        setExplorerWidth(next);
      } else {
        const limit = container ? container.clientHeight - 180 : 600;
        const next = Math.min(limit, Math.max(140, baseHeight - (moveEvent.clientY - startY)));
        setLogHeight(next);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = kind === 'explorer' ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const currentDevice = devices.find((device) => device.serial === serial);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">DS</span>
          <span className="brand-name">Droid Studio Lite</span>
        </div>

        <div className="toolbar-group">
          <label className="field-label" htmlFor="device-select">
            设备
          </label>
          <select
            id="device-select"
            className="select"
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
          >
            {!devices.length && <option value="">未检测到设备</option>}
            {devices.map((device) => (
              <option key={device.serial} value={device.serial}>
                {device.model ?? device.serial} · {device.serial}
                {device.state !== 'device' ? ` (${device.state})` : ''}
              </option>
            ))}
          </select>
          <span
            className={`dot ${currentDevice?.state === 'device' ? 'dot-ok' : 'dot-bad'}`}
            title={currentDevice?.state ?? 'disconnected'}
          />
        </div>

        <div className="toolbar-group">
          <button className="btn" onClick={openLocalFiles} title="打开本地文件 (Ctrl+O)">
            打开文件
          </button>
          <button className="btn" onClick={saveActive} disabled={!activeTab} title="保存 (Ctrl+S)">
            保存
          </button>
          <button className="btn" onClick={() => void saveAs()} disabled={!activeTab}>
            另存为
          </button>
        </div>

        <div className="toolbar-spacer" />

        <div className="toolbar-group">
          <button
            className={`btn ${explorerVisible ? 'btn-active' : ''}`}
            onClick={() => setExplorerVisible((value) => !value)}
          >
            资源管理器
          </button>
          <button
            className={`btn ${logVisible ? 'btn-active' : ''}`}
            onClick={() => setLogVisible((value) => !value)}
          >
            Logcat
          </button>
          <button className="btn" onClick={chooseAdb} title={adb?.adbPath ?? '未找到 adb'}>
            adb 设置
          </button>
        </div>
      </header>

      <div className="workspace">
        {explorerVisible && (
          <>
            <aside className="explorer" style={{ width: explorerWidth }}>
              <DeviceExplorer
                serial={serial}
                jumpPath={jumpPath}
                onOpenFile={openRemoteFile}
                onNotify={notify}
              />
            </aside>
            <div
              className="resizer resizer-v"
              onMouseDown={(event) => startDrag('explorer', event, null)}
            />
          </>
        )}

        <main className="center">
          <EditorPane
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onClose={closeTab}
            onChange={updateContent}
            onSave={() => void saveActive()}
          />

          {logVisible && (
            <>
              <div
                className="resizer resizer-h"
                onMouseDown={(event) => startDrag('log', event, event.currentTarget.parentElement)}
              />
              <section className="logcat-wrap" style={{ height: logHeight }}>
                <LogcatPanel
                  entries={entries}
                  state={logState}
                  detail={logDetail}
                  serial={serial}
                  onClear={clearLogcat}
                  onExport={exportLogs}
                  onRestart={restartLogcat}
                  onStop={stopLogcat}
                />
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>{adb?.ok ? `adb ${adb.version ?? ''}` : 'adb 未就绪'}</span>
        <span className="sep">|</span>
        <span>{currentDevice ? `${currentDevice.model ?? ''} ${currentDevice.serial}` : '无设备'}</span>
        <span className="sep">|</span>
        <span>
          Logcat {logState}
          {entries.length ? ` · ${entries.length.toLocaleString()} 行` : ''}
        </span>
        <span className="statusbar-spacer" />
        <span className="muted">{activeTab ? activeTab.path : '未打开文件'}</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
