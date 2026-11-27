import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { LogEntry, LogcatState } from '../types';
import { redact, REDACT_ENABLED } from '../lib/redact';

const ROW_HEIGHT = 20;
const ALL_LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'];

const LEVEL_CLASS: Record<string, string> = {
  V: 'lv-v',
  D: 'lv-d',
  I: 'lv-i',
  W: 'lv-w',
  E: 'lv-e',
  F: 'lv-f',
  A: 'lv-f'
};

interface Props {
  entries: LogEntry[];
  state: LogcatState;
  detail: string;
  serial: string;
  onClear: () => void;
  onExport: (lines: LogEntry[]) => void;
  onRecord: (content: string) => void;
  onRestart: () => void;
  onStop: () => void;
}

export default function LogcatPanel({
  entries,
  state,
  detail,
  serial,
  onClear,
  onExport,
  onRecord,
  onRestart,
  onStop
}: Props) {
  const [levels, setLevels] = useState<string[]>(ALL_LEVELS);
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');
  const [pidFilter, setPidFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState<LogEntry[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(320);
  const [rowSelection, setRowSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: LogEntry;
  } | null>(null);
  const [copyHint, setCopyHint] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hintTimer = useRef<number | null>(null);

  const source = paused ? snapshot : entries;

  const filtered = useMemo(() => {
    const tag = tagFilter.trim().toLowerCase();
    const text = query.trim().toLowerCase();
    const pid = pidFilter.trim();
    if (!REDACT_ENABLED && !tag && !text && !pid && levels.length === ALL_LEVELS.length) {
      return source;
    }
    return source.filter((entry) => {
      if (!levels.includes(entry.level)) return false;
      if (REDACT_ENABLED && (entry.tag === 'Unity' || /hwyad/i.test(entry.tag))) return false;
      if (pid && String(entry.pid) !== pid) return false;
      if (tag && !entry.tag.toLowerCase().includes(tag)) return false;
      if (text) {
        const haystack = `${entry.message}\n${entry.tag}`.toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });
  }, [source, levels, tagFilter, query, pidFilter]);

  const selectedIds = useMemo(() => {
    if (!rowSelection) return new Set<number>();
    const anchorIndex = filtered.findIndex((entry) => entry.id === rowSelection.anchor);
    const focusIndex = filtered.findIndex((entry) => entry.id === rowSelection.focus);
    if (anchorIndex < 0 || focusIndex < 0) return new Set<number>();
    const from = Math.min(anchorIndex, focusIndex);
    const to = Math.max(anchorIndex, focusIndex);
    return new Set(filtered.slice(from, to + 1).map((entry) => entry.id));
  }, [rowSelection, filtered]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  useEffect(
    () => () => {
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    },
    []
  );

  const formatEntry = (entry: LogEntry) =>
    `${entry.date} ${entry.time} ${String(entry.pid).padStart(5)} ${String(entry.tid).padStart(
      5
    )} ${entry.level} ${redact(entry.tag)}: ${redact(entry.message)}`;

  const flashHint = (text: string) => {
    setCopyHint(text);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setCopyHint(''), 1800);
  };

  const writeClipboard = async (text: string, label: string) => {
    if (!text) return;
    try {
      await window.api.writeClipboard(text);
      flashHint(label);
    } catch {
      flashHint('复制失败');
    }
  };

  const copySelectedRows = () => {
    const lines = filtered.filter((entry) => selectedIds.has(entry.id)).map(formatEntry);
    if (!lines.length) return;
    void writeClipboard(lines.join('\n'), `已复制 ${lines.length} 行`);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setRowSelection(null);
      setContextMenu(null);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      const selection = window.getSelection();
      const inside =
        selection && selection.anchorNode && scrollRef.current?.contains(selection.anchorNode);
      const selectedText = selection?.toString() ?? '';
      if (inside && selectedText.trim()) {
        event.preventDefault();
        void writeClipboard(selectedText, '已复制所选文本');
        return;
      }
      if (selectedIds.size) {
        event.preventDefault();
        copySelectedRows();
      }
    }
  };

  const handleRowClick = (entry: LogEntry, event: ReactMouseEvent<HTMLDivElement>) => {
    scrollRef.current?.focus({ preventScroll: true });
    if (event.shiftKey && rowSelection) {
      setRowSelection({ anchor: rowSelection.anchor, focus: entry.id });
    } else {
      setRowSelection({ anchor: entry.id, focus: entry.id });
    }
  };

  const openContextMenu = (entry: LogEntry, event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!selectedIds.has(entry.id)) {
      setRowSelection({ anchor: entry.id, focus: entry.id });
    }
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 170),
      entry
    });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewHeight(el.clientHeight));
    observer.observe(el);
    setViewHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoScroll || paused) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, [filtered.length, autoScroll, paused]);

  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
  const end = Math.min(total, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 8);
  const visible = filtered.slice(start, end);

  const toggleLevel = (level: string) => {
    setLevels((prev) =>
      prev.includes(level) ? prev.filter((item) => item !== level) : [...prev, level]
    );
  };

  const togglePause = () => {
    if (!paused) setSnapshot(entries);
    setPaused((value) => !value);
  };

  const stateLabel: Record<string, string> = {
    idle: '未连接',
    running: '运行中',
    stopped: '已停止',
    disconnected: '重连中',
    error: '错误'
  };

  return (
    <div className="logcat">
      <div className="logcat-toolbar">
        <div className="level-group">
          {ALL_LEVELS.map((level) => (
            <button
              key={level}
              className={`level-chip ${LEVEL_CLASS[level]} ${levels.includes(level) ? 'on' : 'off'}`}
              onClick={() => toggleLevel(level)}
              title={`切换 ${level} 级别`}
            >
              {level}
            </button>
          ))}
        </div>
        <input
          className="input input-sm"
          placeholder="tag 过滤"
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
        />
        <input
          className="input input-sm"
          placeholder="内容搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <input
          className="input input-xs"
          placeholder="pid"
          value={pidFilter}
          onChange={(event) => setPidFilter(event.target.value.replace(/[^\d]/g, ''))}
        />
        <div className="logcat-actions">
          <button
            className={`btn btn-sm ${autoScroll ? 'btn-active' : ''}`}
            onClick={() => setAutoScroll((value) => !value)}
            title="自动滚到底部"
          >
            跟随
          </button>
          <button className={`btn btn-sm ${paused ? 'btn-warn' : ''}`} onClick={togglePause}>
            {paused ? '恢复' : '暂停'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => onRecord(filtered.map(formatEntry).join('\n'))}
            disabled={!filtered.length}
            title="将当前筛选的全部日志复制到新标签页，可编辑和搜索"
          >
            记录
          </button>
          <button className="btn btn-sm" onClick={onClear} disabled={!serial}>
            清空
          </button>
          <button
            className="btn btn-sm"
            onClick={() => onExport(filtered)}
            disabled={!filtered.length}
          >
            导出
          </button>
          {state === 'running' || state === 'disconnected' ? (
            <button className="btn btn-sm" onClick={onStop} disabled={!serial}>
              停止
            </button>
          ) : (
            <button className="btn btn-sm" onClick={onRestart} disabled={!serial}>
              开始
            </button>
          )}
        </div>
      </div>

      <div className="logcat-status">
        <span className={`badge badge-${state}`}>{stateLabel[state] ?? state}</span>
        {detail && <span className="logcat-detail">{redact(detail)}</span>}
        <span className="logcat-count">
          {total.toLocaleString()} / {source.length.toLocaleString()} 行
          {paused && ' · 已暂停刷新'}
        </span>
        {copyHint && <span className="copy-hint">{copyHint}</span>}
      </div>

      <div
        className="logcat-body"
        ref={scrollRef}
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={handleKeyDown}
      >
        {!total && (
          <div className="empty-hint">
            {serial ? '等待日志输出…' : '请先连接设备'}
          </div>
        )}
        <div className="logcat-canvas" style={{ height: total * ROW_HEIGHT }}>
          {visible.map((entry, index) => (
            <div
              className={`log-row ${selectedIds.has(entry.id) ? 'selected' : ''}`}
              key={entry.id}
              style={{ top: (start + index) * ROW_HEIGHT }}
              onClick={(event) => handleRowClick(entry, event)}
              onContextMenu={(event) => openContextMenu(entry, event)}
            >
              <span className="log-time">
                {entry.time}
              </span>
              <span className="log-pid">{entry.pid}</span>
              <span className={`log-level ${LEVEL_CLASS[entry.level] ?? ''}`}>
                {entry.level}
              </span>
              <span className="log-tag">{redact(entry.tag)}</span>
              <span className={`log-msg ${LEVEL_CLASS[entry.level] ?? ''}`}>
                {redact(entry.message).replace(/\n/g, ' ↵ ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {contextMenu && (
        <div
          className="row-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              void writeClipboard(formatEntry(contextMenu.entry), '已复制该行');
              setContextMenu(null);
            }}
          >
            复制此行
          </button>
          <button
            onClick={() => {
              void writeClipboard(redact(contextMenu.entry.message), '已复制消息');
              setContextMenu(null);
            }}
          >
            复制消息
          </button>
          <button
            onClick={() => {
              void writeClipboard(redact(contextMenu.entry.tag), '已复制 tag');
              setContextMenu(null);
            }}
          >
            复制 tag
          </button>
          {selectedIds.size > 1 && (
            <button
              onClick={() => {
                copySelectedRows();
                setContextMenu(null);
              }}
            >
              复制选中 {selectedIds.size} 行
            </button>
          )}
        </div>
      )}
    </div>
  );
}
