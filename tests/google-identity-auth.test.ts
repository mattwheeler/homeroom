import { describe, expect, it, vi } from "vitest";

import {
  completeGoogleIdentityAuthorization,
  createGoogleIdentityAuthorization,
  GoogleIdentityError
} from "../lib/auth/google-identity";
import { verifyIdentityToken } from "../lib/security/identity-token";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const common = {
  clientId: "client.apps.googleusercontent.com",
  redirectUri: "https://homeroom.example/api/auth/google/callback",
  signingSecret,
  now: () => new Date("2026-07-19T18:00:00.000Z"),
  randomBytes: (size: number) => Uint8Array.from({ length: size }, (_, index) => (index % 251) + 1)
};

describe("Google OpenID identity authentication", () => {
  it("starts a separate OIDC authorization with state, nonce, PKCE, and identity-only scopes", async () => {
    const result = await createGoogleIdentityAuthorization({ ...common, role: "student" });
    const url = new URL(result.authorizationUrl);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("scope")).not.toContain("classroom");
    expect(result.intentToken).not.toContain(url.searchParams.get("state")!);
  });

  it("exchanges and validates the ID token, then binds an allowlisted email to exactly one role", async () => {
    const started = await createGoogleIdentityAuthorization({ ...common, role: "student" });
    const url = new URL(started.authorizationUrl);
    const exchange = vi.fn().mockResolvedValue({ idToken: "signed-google-id-token" });
    const verifyIdToken = vi.fn().mockResolvedValue({
      subject: "google-sub-emily",
      email: "emily@example.com",
      emailVerified: true,
      nonce: url.searchParams.get("nonce")
    });

    const result = await completeGoogleIdentityAuthorization({
      ...common,
      intentToken: started.intentToken,
      state: url.searchParams.get("state")!,
      code: "one-time-code",
      guardianEmails: ["guardian@example.com"],
      studentEmails: ["emily@example.com"],
      clientSecret: "client-secret",
      exchange,
      verifyIdToken
    });

    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({
      code: "one-time-code",
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    }));
    expect(verifyIdToken).toHaveBeenCalledWith(expect.objectContaining({
      idToken: "signed-google-id-token",
      audience: common.clientId,
      nonce: url.searchParams.get("nonce")
    }));
    expect(result.identity).toEqual({
      provider: "google",
      subject: "google-sub-emily",
      email: "emily@example.com",
      role: "student"
    });
    await expect(verifyIdentityToken(
      result.identityToken,
      signingSecret,
      Date.parse("2026-07-19T19:00:00.000Z")
    )).resolves.toMatchObject({ role: "student", subject: "google-sub-emily" });
  });

  it("fails closed on state, nonce, unverified email, unknown account, or cross-role use", async () => {
    const started = await createGoogleIdentityAuthorization({ ...common, role: "guardian" });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const base = {
      ...common,
      intentToken: started.intentToken,
      state,
      code: "one-time-code",
      guardianEmails: ["guardian@example.com"],
      studentEmails: ["emily@example.com"],
      clientSecret: "client-secret",
      exchange: vi.fn().mockResolvedValue({ idToken: "id-token" })
    };

    await expect(completeGoogleIdentityAuthorization({
      ...base,
      state: "tampered-state",
      verifyIdToken: vi.fn()
    })).rejects.toBeInstanceOf(GoogleIdentityError);

    await expect(completeGoogleIdentityAuthorization({
      ...base,
      verifyIdToken: vi.fn().mockResolvedValue({
        subject: "sub", email: "guardian@example.com", emailVerified: true, nonce: "wrong"
      })
    })).rejects.toMatchObject({ code: "IDENTITY_TOKEN_INVALID" });

    await expect(completeGoogleIdentityAuthorization({
      ...base,
      verifyIdToken: vi.fn().mockResolvedValue({
        subject: "sub", email: "guardian@example.com", emailVerified: false, nonce: new URL(started.authorizationUrl).searchParams.get("nonce")
      })
    })).rejects.toMatchObject({ code: "IDENTITY_EMAIL_UNVERIFIED" });

    await expect(completeGoogleIdentityAuthorization({
      ...base,
      verifyIdToken: vi.fn().mockResolvedValue({
        subject: "sub", email: "emily@example.com", emailVerified: true, nonce: new URL(started.authorizationUrl).searchParams.get("nonce")
      })
    })).rejects.toMatchObject({ code: "IDENTITY_ROLE_MISMATCH" });

    await expect(completeGoogleIdentityAuthorization({
      ...base,
      verifyIdToken: vi.fn().mockResolvedValue({
        subject: "sub", email: "unknown@example.com", emailVerified: true, nonce: new URL(started.authorizationUrl).searchParams.get("nonce")
      })
    })).rejects.toMatchObject({ code: "IDENTITY_NOT_ALLOWED" });
  });
});
