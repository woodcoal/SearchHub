import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
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
  dir: string;
  retentionDays: number;
  toStdout: boolean;
}): LogDestination {
  mkdirSync(options.dir, { recursive: true });
  const removed = pruneLogs(options.dir, options.retentionDays);
  let currentFile = '';
  let announced = false;

  return {
    write(chunk: string): void {
      const file = dailyLogFile(options.dir);
      if (file !== currentFile) {
        currentFile = file;
        announced = false;
      }
      try {
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
