import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "../lib/security/rate-limit";

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
