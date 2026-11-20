import { adbExec } from './adb';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

function quote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function joinRemote(dir: string, name: string) {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

const LS_LINE =
  /^([-dlbcps][rwxstST-]{9}[+@.]?)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d,-]+)\s+(\S+)\s+(\S+)\s+([\s\S]*)$/;

export async function listDir(
  userDataDir: string,
  serial: string,
  remotePath: string
): Promise<RemoteEntry[]> {
  // toybox 的 ls 不会展开作为参数传入的符号链接目录，补斜杠强制进入目录
  const lsPath = remotePath.endsWith('/') ? remotePath : `${remotePath}/`;
  const target = quote(lsPath);
  const { stdout, stderr, code } = await adbExec(
    userDataDir,
    ['shell', `ls -la ${target} 2>&1`],
    serial,
    20000
  );
  const combined = `${stdout}${stderr}`;
  if (code !== 0 || /Permission denied/i.test(combined)) {
    throw new Error(
      /Permission denied/i.test(combined)
        ? `权限不足：${remotePath}\n（Android 限制，非 root 无法访问其他应用的私有目录）`
        : combined.trim() || `无法读取 ${remotePath}`
    );
  }

  const entries: RemoteEntry[] = [];
  for (const rawLine of combined.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || /^total\s/i.test(line) || line.startsWith('ls:')) continue;
    const match = LS_LINE.exec(line);
    if (!match) continue;
    const [, mode, , , , size, date, , rawName] = match;
    if (rawName === '.' || rawName === '..') continue;

    let name = rawName;
    let targetPath: string | undefined;
    const arrow = rawName.indexOf(' -> ');
    if (arrow > 0) {
      name = rawName.slice(0, arrow);
      targetPath = rawName.slice(arrow + 4);
    }

    entries.push({
      name,
      path: joinRemote(remotePath, name),
      isDir: mode.startsWith('d'),
      isLink: mode.startsWith('l'),
      size: Number(size) || 0,
      mode,
      date,
      target: targetPath
    });
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return entries;
}

export async function remoteStat(
  userDataDir: string,
  serial: string,
  remotePath: string
): Promise<{ size: number; mode: string; isDir: boolean }> {
  const target = quote(remotePath);
  const { stdout } = await adbExec(
    userDataDir,
    ['shell', `stat -c '%s|%a|%F' ${target} 2>/dev/null`],
    serial
  );
  const [sizeRaw, modeRaw, typeRaw] = stdout.trim().split('|');
  return {
    size: Number(sizeRaw) || 0,
    mode: (modeRaw || '644').trim(),
    isDir: (typeRaw || '').includes('directory')
  };
}

export async function readRemoteText(
  userDataDir: string,
  serial: string,
  remotePath: string,
  maxBytes = 8 * 1024 * 1024
): Promise<string> {
  const stat = await remoteStat(userDataDir, serial, remotePath);
  if (stat.isDir) throw new Error('目标是目录，无法作为文本打开');
  if (stat.size > maxBytes) {
    throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MB)，超过编辑上限`);
  }
  const { stdout, stderr, code } = await adbExec(
    userDataDir,
    ['exec-out', `cat ${quote(remotePath)} 2>/dev/null`],
    serial,
    30000
  );
  if (code !== 0) throw new Error(stderr.trim() || '读取失败');
  if (stat.size > 0 && Buffer.byteLength(stdout, 'utf8') < stat.size) {
    throw new Error(`无法完整读取 ${remotePath}（权限不足或文件被占用）`);
  }
  if (stdout.includes('\u0000')) {
    throw new Error('这是二进制文件，编辑器仅支持文本');
  }
  return stdout;
}

export async function writeRemoteText(
  userDataDir: string,
  serial: string,
  remotePath: string,
  content: string
): Promise<void> {
  let mode = '644';
  try {
    mode = (await remoteStat(userDataDir, serial, remotePath)).mode;
  } catch {
    /* 新文件保持默认权限 */
  }

  const scratch = mkdtempSync(path.join(tmpdir(), 'dsl-push-'));
  const localFile = path.join(scratch, 'payload.txt');
  writeFileSync(localFile, content, 'utf8');
  try {
    const push = await adbExec(userDataDir, ['push', localFile, remotePath], serial, 60000);
    if (push.code !== 0) {
      const detail = `${push.stderr}${push.stdout}`.trim();
      throw new Error(detail || `写入失败：${remotePath}`);
    }
    const chmodResult = await adbExec(
      userDataDir,
      ['shell', `chmod ${mode} ${quote(remotePath)} 2>&1`],
      serial
    );
    if (chmodResult.code !== 0) {
      const detail = `${chmodResult.stdout}${chmodResult.stderr}`.trim();
      if (detail && !/Permission denied/i.test(detail)) {
        throw new Error(detail);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function pullRemote(
  userDataDir: string,
  serial: string,
  remotePath: string,
  localDir: string
): Promise<string> {
  const result = await adbExec(
    userDataDir,
    ['pull', remotePath, localDir],
    serial,
    10 * 60 * 1000
  );
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || '下载失败');
  }
  return result.stdout.trim();
}

export async function pushLocal(
  userDataDir: string,
  serial: string,
  localPaths: string[],
  remoteDir: string
): Promise<string> {
  let last = '';
  for (const localPath of localPaths) {
    const result = await adbExec(
      userDataDir,
      ['push', localPath, remoteDir],
      serial,
      10 * 60 * 1000
    );
    if (result.code !== 0) {
      const detail = `${result.stderr}${result.stdout}`.trim();
      throw new Error(detail || `上传失败: ${localPath}`);
    }
    last = result.stdout.trim();
  }
  return last;
}

export async function removeRemote(
  userDataDir: string,
  serial: string,
  remotePaths: string[]
): Promise<void> {
  for (const remotePath of remotePaths) {
    const result = await adbExec(
      userDataDir,
      ['shell', `rm -rf ${quote(remotePath)} 2>&1`],
      serial
    );
    const detail = `${result.stdout}${result.stderr}`.trim();
    if (detail && /(Permission denied|Read-only|No such)/i.test(detail)) {
      throw new Error(detail);
    }
  }
}

export async function makeDir(
  userDataDir: string,
  serial: string,
  remotePath: string
): Promise<void> {
  const result = await adbExec(
    userDataDir,
    ['shell', `mkdir -p ${quote(remotePath)} 2>&1`],
    serial
  );
  const detail = `${result.stdout}${result.stderr}`.trim();
  if (detail && /(Permission denied|Read-only)/i.test(detail)) throw new Error(detail);
}
