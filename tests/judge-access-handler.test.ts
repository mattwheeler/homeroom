import { describe, expect, it } from "vitest";

import { handleJudgeAccess } from "../lib/http/judge-access-handler";
import { verifyIdentityToken } from "../lib/security/identity-token";
import type { RateLimiter } from "../lib/security/rate-limit";

const secret = "judge-access-signing-secret-that-is-long-enough";
const accessCode = "openai-build-week-review-code-2026";

function request(body: unknown, origin = "https://homeroom.example") {
  return new Request("https://homeroom.example/api/auth/judge", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function dependencies(allowed = true) {
  return {
    accessCode,
    signingSecret: secret,
    studentEmail: "emily@example.com",
    guardianEmail: "matt@example.com",
    rateLimiter: { consume: () => allowed } satisfies RateLimiter,
    clientKey: "203.0.113.10",
    secureCookie: true,
    now: () => 1_000
  };
}

describe("Build Week judge access", () => {
  it("issues a short-lived, role-bound identity and clears an old product session", async () => {
    const response = await handleJudgeAccess(request({ role: "student", code: accessCode }), dependencies());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ redirectPath: "/student" });

    const cookieHeader = response.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("homeroom_identity=");
    expect(cookieHeader).toContain("homeroom_session=");
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toContain("Max-Age=7200");

    const encodedToken = /homeroom_identity=([^;,]+)/.exec(cookieHeader)?.[1];
    expect(encodedToken).toBeTruthy();
    const identity = await verifyIdentityToken(decodeURIComponent(encodedToken ?? ""), secret, 1_000);
    expect(identity).toEqual({
      provider: "judge",
      subject: "openai-build-week-judge-v1:student",
      email: "emily@example.com",
      role: "student"
    });
  });

  it("rejects a wrong code, cross-origin requests, and exhausted rate limits", async () => {
    expect((await handleJudgeAccess(request({ role: "guardian", code: "wrong" }), dependencies())).status).toBe(403);
    expect((await handleJudgeAccess(request({ role: "guardian", code: accessCode }, "https://evil.example"), dependencies())).status).toBe(403);
    expect((await handleJudgeAccess(request({ role: "guardian", code: accessCode }), dependencies(false))).status).toBe(429);
  });

  it("fails closed when review access is not strongly configured", async () => {
    const response = await handleJudgeAccess(request({ role: "guardian", code: "short" }), {
      ...dependencies(),
      accessCode: "short"
    });
    expect(response.status).toBe(503);
  });
});
