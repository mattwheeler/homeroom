import type { D1DatabaseLike } from "../storage/session-store";

export interface RateLimiter {
  consume(key: string): boolean | Promise<boolean>;
}

export class D1FixedWindowRateLimiter implements RateLimiter {
  private readonly now: () => number;

  constructor(
    private readonly database: D1DatabaseLike,
    private readonly options: { limit: number; windowMs: number; now?: () => number; namespace?: string }
  ) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.windowMs < 1) {
      throw new TypeError("Rate-limit settings must be positive.");
    }
    this.now = options.now ?? Date.now;
  }

  async consume(rawKey: string): Promise<boolean> {
    const now = this.now();
    const windowStartedAt = Math.floor(now / this.options.windowMs) * this.options.windowMs;
    const expiresAt = windowStartedAt + this.options.windowMs;
    const key = this.options.namespace ? `${this.options.namespace}:${rawKey}` : rawKey;
    const row = await this.database.prepare(
      `INSERT INTO rate_limit_windows (key, window_started_at, count, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         window_started_at = CASE WHEN rate_limit_windows.expires_at <= ? THEN excluded.window_started_at ELSE rate_limit_windows.window_started_at END,
         count = CASE WHEN rate_limit_windows.expires_at <= ? THEN 1 ELSE rate_limit_windows.count + 1 END,
         expires_at = CASE WHEN rate_limit_windows.expires_at <= ? THEN excluded.expires_at ELSE rate_limit_windows.expires_at END
       RETURNING count`
    ).bind(key, windowStartedAt, expiresAt, now, now, now).first<{ count: number }>();
    return Boolean(row && row.count <= this.options.limit);
  }
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly now: () => number;

  constructor(
    private readonly options: { limit: number; windowMs: number; now?: () => number }
  ) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.windowMs < 1) {
      throw new TypeError("Rate-limit settings must be positive.");
    }
    this.now = options.now ?? Date.now;
  }

  consume(key: string): boolean {
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || now >= current.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return true;
    }
    if (current.count >= this.options.limit) return false;
    current.count += 1;
    return true;
  }
}
