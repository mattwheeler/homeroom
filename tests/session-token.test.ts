import { describe, expect, it } from "vitest";
import { SessionTokenError, signSessionToken, verifySessionToken, type SessionTokenPayload } from "../lib/security/session-token";

describe("signed role session tokens", () => {
  const secret = "test-secret-that-is-long-enough-for-hmac";

  it("round-trips a student token", async () => {
    const token = await signSessionToken(
      { sessionId: "session_1", role: "student", expiresAt: 10_000 },
      secret
    );
    await expect(verifySessionToken(token, secret, 9_000)).resolves.toEqual({
      sessionId: "session_1",
      role: "student",
      expiresAt: 10_000
    });
  });

  it("rejects tampering", async () => {
    const token = await signSessionToken(
      { sessionId: "session_1", role: "guardian", expiresAt: 10_000 },
      secret
    );
    await expect(verifySessionToken(token + "x", secret, 9_000)).rejects.toBeInstanceOf(
      SessionTokenError
    );
  });

  it("rejects expiration", async () => {
    const token = await signSessionToken(
      { sessionId: "session_1", role: "student", expiresAt: 10_000 },
      secret
    );
    await expect(verifySessionToken(token, secret, 10_001)).rejects.toMatchObject({
      code: "SESSION_EXPIRED"
    });
  });

  it("rejects malformed tokens, invalid payload roles, and weak secrets", async () => {
    await expect(verifySessionToken("not-a-token", secret, 1)).rejects.toMatchObject({
      code: "INVALID_SESSION"
    });
    await expect(
      signSessionToken({ sessionId: "session_1", role: "student", expiresAt: 10_000 }, "short")
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });
    const invalidRoleToken = await signSessionToken(
      { sessionId: "session_1", role: "teacher", expiresAt: 10_000 } as unknown as SessionTokenPayload,
      secret
    );
    await expect(verifySessionToken(invalidRoleToken, secret, 9_000)).rejects.toMatchObject({
      code: "INVALID_SESSION"
    });
  });
});
