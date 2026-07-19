import { describe, expect, it, vi } from "vitest";

import {
  handleGoogleIdentityCallback,
  handleGoogleIdentityStart
} from "../lib/http/google-identity-handler";
import type { RateLimiter } from "../lib/security/rate-limit";

const allow: RateLimiter = { consume: () => true };

describe("Google identity HTTP boundary", () => {
  it("starts sign-in from same origin and stores the intent only in a callback-scoped HttpOnly cookie", async () => {
    const start = vi.fn().mockResolvedValue({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=public-state",
      intentToken: "signed-private-intent"
    });
    const response = await handleGoogleIdentityStart(new Request("https://homeroom.example/api/auth/google/start", {
      method: "POST",
      headers: { origin: "https://homeroom.example", "content-type": "application/json" },
      body: JSON.stringify({ role: "student" })
    }), {
      rateLimiter: allow,
      clientKey: "client",
      secureCookie: true,
      start
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authorizationUrl: expect.stringContaining("accounts.google.com") });
    expect(start).toHaveBeenCalledWith("student");
    expect(response.headers.get("set-cookie")).toContain("homeroom_auth_intent=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/auth/google/callback");
  });

  it("completes sign-in into a hardened identity cookie and redirects to the bound role", async () => {
    const complete = vi.fn().mockResolvedValue({
      identityToken: "signed-verified-identity",
      redirectPath: "/guardian?auth=connected"
    });
    const response = await handleGoogleIdentityCallback(new Request(
      "https://homeroom.example/api/auth/google/callback?state=public-state&code=one-time-code",
      { headers: { cookie: "homeroom_auth_intent=signed-private-intent" } }
    ), { secureCookie: true, complete });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://homeroom.example/guardian?auth=connected");
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      intentToken: "signed-private-intent",
      state: "public-state",
      code: "one-time-code"
    }));
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("homeroom_identity=signed-verified-identity");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Lax");
    expect(cookies).toContain("Secure");
    expect(cookies).not.toContain("one-time-code");
  });

  it("fails safely without echoing provider details", async () => {
    const response = await handleGoogleIdentityCallback(new Request(
      "https://homeroom.example/api/auth/google/callback?error=access_denied&error_description=private-detail"
    ), { secureCookie: false, complete: vi.fn() });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://homeroom.example/?auth=declined");
    expect(response.headers.get("location")).not.toContain("private-detail");
  });
});
