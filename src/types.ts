export interface DeviceInfo {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  transportId?: string;
}

export interface LogEntry {
  id: number;
  date: string;
  time: string;
  pid: number;
  tid: number;
  level: string;
  tag: string;
  message: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  isLink: boolean;
  size: number;
  mode: string;
  date: string;
  target?: string;
}

export interface EditorTab {
  id: string;
  kind: 'local' | 'remote';
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  serial?: string;
}

export interface AdbStatus {
  adbPath: string | null;
  version: string | null;
  ok: boolean;
}

export type LogcatState = 'idle' | 'running' | 'stopped' | 'disconnected' | 'error';
