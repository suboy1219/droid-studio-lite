import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogcatState } from '../types';

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
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const source = paused ? snapshot : entries;

  const filtered = useMemo(() => {
    const tag = tagFilter.trim().toLowerCase();
    const text = query.trim().toLowerCase();
    const pid = pidFilter.trim();
    if (!tag && !text && !pid && levels.length === ALL_LEVELS.length) return source;
    return source.filter((entry) => {
      if (!levels.includes(entry.level)) return false;
      if (pid && String(entry.pid) !== pid) return false;
      if (tag && !entry.tag.toLowerCase().includes(tag)) return false;
      if (text) {
        const haystack = `${entry.message}\n${entry.tag}`.toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });
  }, [source, levels, tagFilter, query, pidFilter]);

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
        {detail && <span className="logcat-detail">{detail}</span>}
        <span className="logcat-count">
          {total.toLocaleString()} / {source.length.toLocaleString()} 行
          {paused && ' · 已暂停刷新'}
        </span>
      </div>

      <div
        className="logcat-body"
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {!total && (
          <div className="empty-hint">
            {serial ? '等待日志输出…' : '请先连接设备'}
          </div>
        )}
        <div className="logcat-canvas" style={{ height: total * ROW_HEIGHT }}>
          {visible.map((entry, index) => (
            <div
              className="log-row"
              key={entry.id}
              style={{ top: (start + index) * ROW_HEIGHT }}
            >
              <span className="log-time">
                {entry.time}
              </span>
              <span className="log-pid">{entry.pid}</span>
              <span className={`log-level ${LEVEL_CLASS[entry.level] ?? ''}`}>
                {entry.level}
              </span>
              <span className="log-tag">{entry.tag}</span>
              <span className={`log-msg ${LEVEL_CLASS[entry.level] ?? ''}`}>
                {entry.message.replace(/\n/g, ' ↵ ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
