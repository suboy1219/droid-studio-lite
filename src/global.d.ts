import type { AdbStatus, DeviceInfo, EditorTab, LogEntry, RemoteEntry } from './types';

declare global {
  interface Window {
    api: {
      adbStatus(): Promise<AdbStatus>;
      setAdbPath(adbPath: string): Promise<AdbStatus>;
      pickAdbFile(): Promise<AdbStatus | null>;
      listDevices(): Promise<DeviceInfo[]>;
      onDevices(callback: (devices: DeviceInfo[]) => void): () => void;
      startLogcat(options: { serial: string; buffers: string[] }): Promise<{ ok: boolean }>;
      stopLogcat(): Promise<{ ok: boolean }>;
      clearLogcat(serial: string): Promise<{ ok: boolean; detail?: string }>;
      onLogcatBatch(callback: (batch: LogEntry[]) => void): () => void;
      onLogcatStatus(callback: (state: string, detail?: string) => void): () => void;
      fsList(serial: string, dir: string): Promise<RemoteEntry[]>;
      fsReadText(serial: string, target: string): Promise<string>;
      fsWriteText(serial: string, target: string, content: string): Promise<{ ok: boolean }>;
      fsDelete(serial: string, paths: string[]): Promise<{ ok: boolean }>;
      fsMkdir(serial: string, dir: string): Promise<{ ok: boolean }>;
      fsPull(serial: string, remote: string): Promise<{ ok: boolean; canceled?: boolean; output?: string }>;
      fsPush(serial: string, remoteDir: string): Promise<{ ok: boolean; canceled?: boolean; output?: string }>;
      openLocalText(): Promise<{ ok: boolean; canceled?: boolean; files?: EditorTab[] }>;
      readLocalText(filePath: string): Promise<string>;
      saveLocalText(filePath: string, content: string): Promise<{ ok: boolean }>;
      saveLocalTextAs(content: string, suggested: string): Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
      revealInExplorer(filePath: string): Promise<{ ok: boolean }>;
      exportLog(content: string, suggested: string): Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
      writeClipboard(text: string): Promise<{ ok: boolean }>;
    };
  }
}

export {};
