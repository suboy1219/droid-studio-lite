import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface DeviceInfo {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  transportId?: string;
}

const ADB_EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';

let cachedPath: string | null = null;

export function configFile(userDataDir: string) {
  return path.join(userDataDir, 'config.json');
}

export function readConfig(userDataDir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configFile(userDataDir), 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(userDataDir: string, patch: Record<string, unknown>) {
  const next = { ...readConfig(userDataDir), ...patch };
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(configFile(userDataDir), JSON.stringify(next, null, 2), 'utf8');
}

function candidateSdkRoots(): string[] {
  const roots: string[] = [];
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_SDK_HOME']) {
    const value = process.env[key];
    if (value) roots.push(value);
  }
  const local = process.env.LOCALAPPDATA;
  if (local) roots.push(path.join(local, 'Android', 'Sdk'));
  if (process.env.USERPROFILE) {
    roots.push(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk'));
  }
  return roots;
}

function fallbackSdkRoots(): string[] {
  return ['C:\\Android\\Sdk', 'D:\\Android\\Sdk', 'E:\\Android\\Sdk'];
}

export function resolveAdb(userDataDir: string): string | null {
  if (cachedPath && existsSync(cachedPath)) return cachedPath;

  const configured = readConfig(userDataDir).adbPath;
  if (typeof configured === 'string' && configured.trim() && existsSync(configured.trim())) {
    cachedPath = configured.trim();
    return cachedPath;
  }

  for (const root of candidateSdkRoots()) {
    const candidate = path.join(root, 'platform-tools', ADB_EXE);
    if (existsSync(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  for (const entry of pathEntries) {
    if (!entry) continue;
    const candidate = path.join(entry, ADB_EXE);
    if (existsSync(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }

  for (const root of fallbackSdkRoots()) {
    const candidate = path.join(root, 'platform-tools', ADB_EXE);
    if (existsSync(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }
  return null;
}

export function setAdbPath(userDataDir: string, adbPath: string) {
  cachedPath = adbPath;
  writeConfig(userDataDir, { adbPath });
}

export class AdbUnavailableError extends Error {}

export function adbBinary(userDataDir: string): string {
  const resolved = resolveAdb(userDataDir);
  if (!resolved) {
    throw new AdbUnavailableError(
      '未找到 adb。请安装 Android SDK Platform-Tools，或在设置中指定 adb 路径。'
    );
  }
  return resolved;
}

export async function adbExec(
  userDataDir: string,
  args: string[],
  serial?: string,
  timeoutMs = 20000
): Promise<{ stdout: string; stderr: string; code: number }> {
  const bin = adbBinary(userDataDir);
  const fullArgs = serial ? ['-s', serial, ...args] : args;
  try {
    const { stdout, stderr } = await execFileAsync(bin, fullArgs, {
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      timeout: timeoutMs,
      encoding: 'utf8'
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      code: typeof err.code === 'number' ? err.code : 1
    };
  }
}

export async function adbVersion(userDataDir: string): Promise<string | null> {
  if (!resolveAdb(userDataDir)) return null;
  const { stdout } = await adbExec(userDataDir, ['version'], undefined, 8000);
  const first = stdout.split('\n')[0]?.trim();
  return first || null;
}

export async function listDevices(userDataDir: string): Promise<DeviceInfo[]> {
  const { stdout } = await adbExec(userDataDir, ['devices', '-l'], undefined, 12000);
  const devices: DeviceInfo[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('List of devices')) continue;
    if (line.startsWith('*')) continue;
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) continue;
    const info: DeviceInfo = { serial, state };
    for (const token of rest) {
      const idx = token.indexOf(':');
      if (idx <= 0) continue;
      const key = token.slice(0, idx);
      const value = token.slice(idx + 1);
      if (key === 'model') info.model = value.replace(/_/g, ' ');
      else if (key === 'product') info.product = value;
      else if (key === 'transport_id') info.transportId = value;
    }
    devices.push(info);
  }
  return devices;
}
