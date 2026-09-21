import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 默认根目录：~/.search-hub */
export function defaultHome(): string {
  return join(homedir(), '.search-hub');
}

export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SEARCHHUB_HOME?.trim();
  return raw ? resolve(raw) : defaultHome();
}

const LOG_PATTERN = /^searchhub-(\d{4})-(\d{2})-(\d{2})\.log$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dailyLogFile(dir: string, now: Date = new Date()): string {
  return join(dir, `searchhub-${dayStamp(now)}.log`);
}

/**
 * 清理过期日志。按文件名里的日期判断，避免依赖文件系统 mtime。
 * retentionDays <= 0 表示永久保留。
 */
export function pruneLogs(dir: string, retentionDays: number, now: Date = new Date()): number {
  if (retentionDays <= 0) return 0;
  if (!existsSync(dir)) return 0;

  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - retentionDays,
  ).getTime();

  let removed = 0;
  for (const name of readdirSync(dir)) {
    const matched = LOG_PATTERN.exec(name);
    if (!matched) continue;
    const fileDate = Date.parse(`${matched[1]}-${matched[2]}-${matched[3]}T00:00:00`);
    if (Number.isNaN(fileDate) || fileDate >= cutoff) continue;
    try {
      unlinkSync(join(dir, name));
      removed += 1;
    } catch {
      // 文件被占用或已被删除时忽略，下次启动再清理
    }
  }
  return removed;
}

export function logFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LOG_PATTERN.test(name))
    .sort();
}

export interface LogFileInfo {
  name: string;
  size: number;
}

/**
 * 读取日志文件末尾若干字节并按行返回。
 * 日志文件可能很大，只取尾部（默认 512KB），首行可能被截断则丢弃。
 */
export function readTailLines(file: string, maxBytes = 512 * 1024): string[] {
  if (!existsSync(file)) return [];

  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return [];
  }
  if (size === 0) return [];

  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }

  const lines = buffer.toString('utf8').split('\n');
  if (start > 0) lines.shift(); // 起始处大概率是被截断的半行
  return lines.map((line) => line.trim()).filter(Boolean);
}

export function logFileInfos(dir: string): LogFileInfo[] {
  return logFiles(dir).map((name) => {
    try {
      return { name, size: statSync(join(dir, name)).size };
    } catch {
      return { name, size: 0 };
    }
  });
}

export function logDirSize(dir: string): number {
  return logFileInfos(dir).reduce((total, file) => total + file.size, 0);
}

export interface LogDestination {
  write(chunk: string): void;
}

/**
 * 按天切分的日志目的地：文件名自带日期，跨天自动写入新文件，无需额外轮转库。
 * 同时保留 stdout 输出（可用 SEARCHHUB_LOG_STDOUT=false 关闭）。
 */
export function createDailyLogDestination(options: {
  /** 目录可能在运行时被修改（迁移数据目录），所以用取值函数而非固定值 */
  getDir: () => string;
  retentionDays: number;
  toStdout: boolean;
}): LogDestination {
  mkdirSync(options.getDir(), { recursive: true });
  const removed = pruneLogs(options.getDir(), options.retentionDays);
  let currentFile = '';
  let announced = false;

  return {
    write(chunk: string): void {
      const dir = options.getDir();
      const file = dailyLogFile(dir);
      if (file !== currentFile) {
        currentFile = file;
        announced = false;
      }
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(file, chunk.endsWith('\n') ? chunk : `${chunk}\n`, 'utf8');
        if (!announced && removed > 0) {
          appendFileSync(
            file,
            `${new Date().toISOString()} 已清理 ${removed} 个超过 ${options.retentionDays} 天的日志文件\n`,
            'utf8',
          );
        }
        announced = true;
      } catch {
        // 日志写入失败不应影响主流程
      }
      if (options.toStdout) process.stdout.write(chunk);
    },
  };
}
