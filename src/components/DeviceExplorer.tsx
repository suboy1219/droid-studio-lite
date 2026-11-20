import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RemoteEntry } from '../types';

interface Props {
  serial: string;
  jumpPath: string | null;
  onOpenFile: (entry: RemoteEntry) => void;
  onNotify: (message: string) => void;
}

const SHORTCUTS = ['/sdcard', '/sdcard/Download', '/sdcard/Android/data', '/data/local/tmp', '/system/app'];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function parentOf(dir: string) {
  if (dir === '/' || !dir) return '/';
  const trimmed = dir.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

export default function DeviceExplorer({ serial, jumpPath, onOpenFile, onNotify }: Props) {
  const [cwd, setCwd] = useState('/sdcard');
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pathInput, setPathInput] = useState('/sdcard');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(
    async (dir: string) => {
      if (!serial) {
        setEntries([]);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const list = await window.api.fsList(serial, dir);
        setEntries(list);
        setCwd(dir);
        setPathInput(dir);
        setSelected(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEntries([]);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [serial]
  );

  useEffect(() => {
    if (!serial) {
      setEntries([]);
      setError('');
      return;
    }
    void load('/sdcard');
  }, [serial, load]);

  useEffect(() => {
    if (jumpPath) void load(jumpPath);
  }, [jumpPath, load]);

  const crumbs = useMemo(() => {
    const parts = cwd.split('/').filter(Boolean);
    const result: { label: string; path: string }[] = [{ label: '/', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      result.push({ label: part, path: acc });
    }
    return result;
  }, [cwd]);

  const selectedEntry = entries.find((entry) => entry.path === selected) ?? null;

  const activate = (entry: RemoteEntry) => {
    if (entry.isDir) void load(entry.path);
    else onOpenFile(entry);
  };

  const doRefresh = () => void load(cwd);

  const doUp = () => void load(parentOf(cwd));

  const doCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    const target = cwd.endsWith('/') ? `${cwd}${name}` : `${cwd}/${name}`;
    try {
      await window.api.fsMkdir(serial, target);
      setCreating(false);
      setNewName('');
      await load(cwd);
      onNotify(`已创建 ${name}`);
    } catch (err) {
      onNotify(`创建失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doDownload = async () => {
    if (!selected) return;
    try {
      const result = await window.api.fsPull(serial, selected);
      if (result.ok) onNotify(`已下载到 ${result.output ?? ''}`);
    } catch (err) {
      onNotify(`下载失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doUpload = async () => {
    try {
      const result = await window.api.fsPush(serial, cwd);
      if (result.ok) {
        onNotify('上传完成');
        await load(cwd);
      }
    } catch (err) {
      onNotify(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doDelete = async () => {
    if (!selectedEntry) return;
    if (!window.confirm(`确定删除 ${selectedEntry.name} 吗？此操作不可撤销。`)) return;
    try {
      await window.api.fsDelete(serial, [selectedEntry.path]);
      onNotify(`已删除 ${selectedEntry.name}`);
      await load(cwd);
    } catch (err) {
      onNotify(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!serial) {
    return <div className="explorer-empty">连接设备后可浏览文件</div>;
  }

  return (
    <div className="explorer-inner">
      <div className="explorer-head">
        <div className="explorer-title">Device Explorer</div>
        <div className="explorer-tools">
          <button className="icon-btn" onClick={doUp} title="上一级">
            ↑
          </button>
          <button className="icon-btn" onClick={doRefresh} title="刷新">
            ⟳
          </button>
          <button className="icon-btn" onClick={() => setCreating(true)} title="新建文件夹">
            ＋
          </button>
          <button
            className="icon-btn"
            onClick={doDownload}
            disabled={!selected}
            title="下载到本地"
          >
            ⬇
          </button>
          <button className="icon-btn" onClick={doUpload} title="上传文件">
            ⬆
          </button>
          <button
            className="icon-btn icon-danger"
            onClick={doDelete}
            disabled={!selectedEntry}
            title="删除"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="explorer-path">
        <input
          className="input input-sm"
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const next = pathInput.startsWith('/') ? pathInput : `/${pathInput}`;
              void load(next);
            }
          }}
          spellCheck={false}
        />
      </div>

      <div className="explorer-crumbs">
        {crumbs.map((crumb, index) => (
          <span key={crumb.path} className="crumb-wrap">
            {index > 0 && <span className="crumb-sep">/</span>}
            <button className="crumb" onClick={() => void load(crumb.path)}>
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      <div className="explorer-shortcuts">
        {SHORTCUTS.map((path) => (
          <button key={path} className="shortcut" onClick={() => void load(path)} title={path}>
            {path.replace('/sdcard', 'SD')}
          </button>
        ))}
      </div>

      {creating && (
        <div className="inline-create">
          <input
            className="input input-sm"
            autoFocus
            placeholder="文件夹名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void doCreate();
              if (event.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
          />
          <button className="btn btn-sm" onClick={() => void doCreate()}>
            确定
          </button>
        </div>
      )}

      <div className="explorer-list">
        {loading && <div className="explorer-hint">正在读取…</div>}
        {!loading && error && <div className="explorer-error">{error}</div>}
        {!loading && !error && !entries.length && (
          <div className="explorer-hint">空目录</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.path}
            className={`file-row ${selected === entry.path ? 'selected' : ''}`}
            onClick={() => setSelected(entry.path)}
            onDoubleClick={() => activate(entry)}
            title={entry.isLink ? `${entry.path} → ${entry.target ?? ''}` : entry.path}
          >
            <span className="file-icon">
              {entry.isDir ? '📁' : entry.isLink ? '🔗' : '📄'}
            </span>
            <span className="file-name">{entry.name}</span>
            <span className="file-meta">{entry.isDir ? '' : formatSize(entry.size)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
