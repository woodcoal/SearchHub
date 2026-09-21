import { createRequire } from 'node:module';

/** 读取 package.json 里的版本号，dev（源码）与 dist（构建后）两种位置都兼容 */
export function appVersion(): string {
  for (const candidate of ['../package.json', './package.json']) {
    try {
      const pkg = createRequire(import.meta.url)(candidate) as { version?: string };
      if (pkg?.version) return pkg.version;
    } catch {
      // 试下一个位置
    }
  }
  return '0.0.0';
}
