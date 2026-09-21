const RELATIVE_PATTERN = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i;

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/**
 * 各家返回的时间格式五花八门（ISO、"3 days ago"、"Mar 5, 2024"），
 * 统一收敛成 ISO 8601；解析不了就返回 undefined，宁缺勿错。
 */
export function parseLooseDate(input?: string | null): string | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  if (!raw) return undefined;

  const relative = RELATIVE_PATTERN.exec(raw);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const ms = UNIT_MS[unit];
    if (Number.isFinite(amount) && ms) {
      return new Date(Date.now() - amount * ms).toISOString();
    }
    return undefined;
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

export function utcDayStamp(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function utcMonthStamp(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** 下个月 1 号 00:00 UTC */
export function nextUtcMonthStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}
