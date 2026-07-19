import { describe, expect, it } from "vitest";

import {
  IdentityTokenError,
  signIdentityToken,
  type VerifiedIdentity,
  verifyIdentityToken
} from "../lib/security/identity-token";

const secret = "identity-token-test-secret-that-is-long-enough";
const validIdentity: VerifiedIdentity = {
  provider: "google",
  subject: "google-sub-emily",
  email: "emily@example.com",
  role: "student"
};

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function signRaw(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

describe("role-bound identity token validation", () => {
  it("rejects malformed, tampered, expired, and weak-secret tokens", async () => {
    await expect(verifyIdentityToken("missing-separator", secret, 0)).rejects.toBeInstanceOf(IdentityTokenError);
    await expect(verifyIdentityToken(".signature", secret, 0)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
    await expect(verifyIdentityToken("body.", secret, 0)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });

    const signed = await signIdentityToken(validIdentity, secret, 100);
    await expect(verifyIdentityToken(`${signed}tampered`, secret, 0)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
    await expect(verifyIdentityToken(signed, secret, 101)).rejects.toMatchObject({ code: "IDENTITY_EXPIRED" });
    await expect(signIdentityToken(validIdentity, "too-short", 100)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
    await expect(verifyIdentityToken(signed, "too-short", 0)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
  });

  it("rejects signed content that is not valid JSON or a valid identity payload", async () => {
    const invalidJson = await signRaw(base64Url("not-json"));
    await expect(verifyIdentityToken(invalidJson, secret, 0)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });

    const invalidPayloads: unknown[] = [
      null,
      { purpose: "wrong" },
      { ...validIdentity, purpose: "homeroom_identity", provider: "other", expiresAt: 100 },
      { ...validIdentity, purpose: "homeroom_identity", subject: "", expiresAt: 100 },
      { ...validIdentity, purpose: "homeroom_identity", subject: "s".repeat(256), expiresAt: 100 },
      { ...validIdentity, purpose: "homeroom_identity", email: "", expiresAt: 100 },
      { ...validIdentity, purpose: "homeroom_identity", email: `${"a".repeat(310)}@example.com`, expiresAt: 100 },
      { ...validIdentity, purpose: "homeroom_identity", role: "teacher", expiresAt: 100 },
      { ...validIdentity, purpose: "homeroom_identity", expiresAt: "later" }
    ];

    for (const invalidPayload of invalidPayloads) {
      const token = await signRaw(base64Url(JSON.stringify(invalidPayload)));
      await expect(verifyIdentityToken(token, secret, 0)).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
    }
  });
});
