import { appendFileSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AttemptLog } from '../core/types.js';
import { readTailLines } from '../logging.js';

/**
 * 调用日志的持久化接口。
 * 内存里保留最近若干条用于展示，文件里按 JSONL 追加，重启时自动加载。
 */
export interface CallLogPersistence {
  /** 载入历史记录，返回「新 → 旧」 */
  load(): AttemptLog[];
  /** 追加一条记录 */
  append(entry: AttemptLog): void;
  /** 是否需要压缩文件 */
  needsCompact(): boolean;
  /** 用内存快照重写文件（入参为「新 → 旧」） */
  compact(entries: AttemptLog[]): void;
}

/** 单次最多读取的字节数：只取文件尾部，避免大文件把内存撑爆 */
const MAX_READ_BYTES = 2 * 1024 * 1024;

interface RawRecord {
  at?: unknown;
  provider?: unknown;
  ok?: unknown;
}

function isValid(record: RawRecord): record is AttemptLog {
  return (
    typeof record?.at === 'number' &&
    typeof record.provider === 'string' &&
    typeof record.ok === 'boolean'
  );
}

/**
 * 把调用日志落盘到 JSONL 文件：一行一条，读取时只取尾部。
 * 追加达到保留条数后整体重写一次，文件大小稳定在 1~2 倍保留条数之间。
 */
export class FileCallLog implements CallLogPersistence {
  private readonly file: string;
  private readonly limit: number;
  /** 上次压缩后追加的条数 */
  private appended = 0;
  private dirty = false;

  constructor(file: string, limit = 1000) {
    this.file = resolve(file);
    this.limit = limit;
  }

  get path(): string {
    return this.file;
  }

  load(): AttemptLog[] {
    const lines = readTailLines(this.file, MAX_READ_BYTES);
    const entries: AttemptLog[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RawRecord;
        if (isValid(parsed)) entries.push(parsed);
      } catch {
        // 损坏的行直接跳过，不影响其余历史
      }
    }

    // 文件远超上限（例如手工追加过），启动时就压缩一次
    if (entries.length > this.limit * 2) this.dirty = true;

    this.appended = 0;
    // 磁盘上是「旧 → 新」，内存里保持「新 → 旧」
    return entries.slice(-this.limit).reverse();
  }

  append(entry: AttemptLog): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // 写日志失败不能影响搜索主流程
      return;
    }
    this.appended += 1;
    if (this.appended >= this.limit) this.dirty = true;
  }

  needsCompact(): boolean {
    return this.dirty;
  }

  compact(entries: AttemptLog[]): void {
    const kept = entries.slice(0, this.limit);
    const target = this.file;
    const tmp = `${target}.tmp`;

    try {
      if (kept.length === 0) {
        if (existsSync(target)) unlinkSync(target);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        const body = kept
          .slice()
          .reverse()
          .map((entry) => JSON.stringify(entry))
          .join('\n');
        writeFileSync(tmp, `${body}\n`, 'utf8');
        renameSync(tmp, target);
      }
      this.appended = 0;
      this.dirty = false;
    } catch {
      // 压缩失败就下次再试，绝不影响主流程
      this.dirty = false;
      this.appended = 0;
    }
  }
}
