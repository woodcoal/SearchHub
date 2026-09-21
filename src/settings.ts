import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface SettingsData {
  version: number;
  /** 数据目录；null 表示使用默认根目录 */
  dataDir: string | null;
  /** 界面设置的后台密码哈希；null 表示仍用环境变量 / 随机密码 */
  adminPasswordHash: string | null;
  adminPasswordUpdatedAt: string | null;
}

const VERSION = 1;

/**
 * 系统级设置，独立于数据文件保存（默认 <home>/settings.json）。
 * 这样即使数据目录被迁移走，也能找到「数据在哪」以及后台密码。
 */
export class SettingsStore {
  private data: SettingsData;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  static defaultPath(env: NodeJS.ProcessEnv = process.env): string {
    const home = env.SEARCHHUB_HOME?.trim()
      ? resolve(env.SEARCHHUB_HOME.trim())
      : join(homedir(), '.search-hub');
    return join(home, 'settings.json');
  }

  get path(): string {
    return this.file;
  }

  private load(): SettingsData {
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SettingsData>;
        return {
          version: VERSION,
          dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir : null,
          adminPasswordHash:
            typeof parsed.adminPasswordHash === 'string' ? parsed.adminPasswordHash : null,
          adminPasswordUpdatedAt:
            typeof parsed.adminPasswordUpdatedAt === 'string' ? parsed.adminPasswordUpdatedAt : null,
        };
      } catch {
        // 设置文件损坏时退回默认值，不阻断启动
      }
    }
    return {
      version: VERSION,
      dataDir: null,
      adminPasswordHash: null,
      adminPasswordUpdatedAt: null,
    };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  get dataDir(): string | null {
    return this.data.dataDir;
  }

  get adminPasswordHash(): string | null {
    return this.data.adminPasswordHash;
  }

  get adminPasswordUpdatedAt(): string | null {
    return this.data.adminPasswordUpdatedAt;
  }

  setDataDir(dir: string): void {
    this.data.dataDir = resolve(dir);
    this.save();
  }

  setAdminPassword(hash: string): void {
    this.data.adminPasswordHash = hash;
    this.data.adminPasswordUpdatedAt = new Date().toISOString();
    this.save();
  }
}
