import { describe, expect, it } from "vitest";

import { D1FixedWindowRateLimiter, FixedWindowRateLimiter } from "../lib/security/rate-limit";
import type { D1DatabaseLike } from "../lib/storage/session-store";

describe("fixed-window rate limiter", () => {
  it("limits each key and resets after the configured window", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });

    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(true);
    expect(limiter.consume("a")).toBe(false);
    expect(limiter.consume("b")).toBe(true);
    now = 61_001;
    expect(limiter.consume("a")).toBe(true);
  });
});

describe("distributed D1 fixed-window rate limiter", () => {
  it("uses one shared atomic counter and supports per-IP plus per-session keys", async () => {
    let count = 0;
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const database: D1DatabaseLike = {
      prepare(sql) {
        return { bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { success: true, meta: { changes: 1 } }; },
            async first<T>() { count += 1; return { count } as T; }
          };
        } };
      }
    };
    const limiter = new D1FixedWindowRateLimiter(database, { limit: 2, windowMs: 60_000, now: () => 1_000 });
    await expect(limiter.consume("morning-plan:ip:203.0.113.1")).resolves.toBe(true);
    await expect(limiter.consume("morning-plan:ip:203.0.113.1")).resolves.toBe(true);
    await expect(limiter.consume("morning-plan:ip:203.0.113.1")).resolves.toBe(false);
    expect(calls[0]?.sql).toContain("ON CONFLICT");
    expect(calls[0]?.sql).toContain("RETURNING count");
  });
});
