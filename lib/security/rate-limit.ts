export interface RateLimiter {
  consume(key: string): boolean;
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
