import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { adbBinary } from './adb';

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

export interface LogcatOptions {
  serial: string;
  buffers: string[];
}

const HEADER =
  /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:\s?([\s\S]*)$/;

type Emit = (batch: LogEntry[]) => void;
type Status = (state: string, detail?: string) => void;

export class LogcatSession {
  private proc: ChildProcess | null = null;
  private seq = 0;
  private pending: LogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private retries = 0;
  private options: LogcatOptions | null = null;
  private lastEntry: LogEntry | null = null;
  private exitTimer: NodeJS.Timeout | null = null;
  private warmupUntil = 0;
  private warmup: LogEntry[] = [];
  private warmupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly userDataDir: string,
    private readonly emit: Emit,
    private readonly status: Status
  ) {}

  start(options: LogcatOptions) {
    this.options = options;
    this.stopped = false;
    this.retries = 0;
    this.warmupUntil = Date.now() + 1500;
    this.warmup = [];
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = setTimeout(() => this.endWarmup(), 1500);
    this.spawnProc();
  }

  stop() {
    this.stopped = true;
    if (this.exitTimer) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    this.warmup = [];
    this.flush();
    this.lastEntry = null;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.status('stopped');
  }

  isRunning() {
    return Boolean(this.proc) && !this.stopped;
  }

  private spawnProc() {
    if (!this.options) return;
    let bin: string;
    try {
      bin = adbBinary(this.userDataDir);
    } catch (error) {
      this.status('error', (error as Error).message);
      return;
    }

    const args = ['-s', this.options.serial, 'logcat', '-v', 'threadtime'];
    for (const buffer of this.options.buffers) {
      args.push('-b', buffer);
    }


    const proc = spawn(bin, args, { windowsHide: true });
    this.proc = proc;
    this.status('running', this.options.serial);

    const decoder = new StringDecoder('utf8');
    let carry = '';

    const handleChunk = (text: string) => {
      const lines = (carry + text).split(/\r?\n/);
      carry = lines.pop() ?? '';
      for (const line of lines) this.consumeLine(line);
    };

    proc.stdout?.on('data', (chunk: Buffer) => handleChunk(decoder.write(chunk)));
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk).trim();
      if (text) this.status('stderr', text);
    });

    proc.on('error', (error) => {
      this.status('error', error.message);
    });

    proc.on('exit', (code, signal) => {
      this.proc = null;
      if (this.stopped) return;
      this.status('disconnected', `adb logcat 退出 (code=${code ?? signal ?? '?'})`);
      const delay = Math.min(1000 * 2 ** this.retries, 8000);
      this.retries += 1;
      if (this.retries > 12) {
        this.status('error', '多次重连失败，已停止');
        this.stopped = true;
        return;
      }
      this.exitTimer = setTimeout(() => {
        this.exitTimer = null;
        if (!this.stopped) this.spawnProc();
      }, delay);
    });
  }

  private consumeLine(line: string) {
    if (!line) return;
    const match = HEADER.exec(line);
    if (!match) {
      if (this.lastEntry) {
        this.lastEntry.message += `\n${line}`;
      }
      return;
    }
    const [, date, time, pid, tid, level, rawTag, message] = match;
    const entry: LogEntry = {
      id: ++this.seq,
      date,
      time,
      pid: Number(pid),
      tid: Number(tid),
      level,
      tag: rawTag.trim(),
      message
    };
    this.lastEntry = entry;
    if (Date.now() < this.warmupUntil) {
      this.warmup.push(entry);
      if (this.warmup.length > 4000) {
        this.warmup.splice(0, this.warmup.length - 4000);
      }
      return;
    }
    this.pending.push(entry);
    if (this.pending.length >= 400) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, 70);
    }
  }

  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.emit(batch);
  }

  private endWarmup() {
    this.warmupTimer = null;
    this.warmupUntil = 0;
    if (!this.warmup.length) return;
    const batch = this.warmup;
    this.warmup = [];
    this.emit(batch);
  }
}
