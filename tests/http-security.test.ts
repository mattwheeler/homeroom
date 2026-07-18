import { describe, expect, it } from "vitest";

import {
  assertJsonRequest,
  assertSameOrigin,
  serializeSessionCookie,
  verifyCsrfToken
} from "../lib/security/http";
import { createHash } from "node:crypto";

describe("HTTP security boundary", () => {
  it("accepts an exact same-origin JSON request", () => {
    const request = new Request("https://homeroom.example/api/demo-sessions", {
      method: "POST",
      headers: {
        origin: "https://homeroom.example",
        "content-type": "application/json; charset=utf-8"
      }
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
    expect(() => assertJsonRequest(request)).not.toThrow();
  });

  it("rejects cross-origin and non-JSON requests", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://homeroom.example/api/demo-sessions", {
          method: "POST",
          headers: { origin: "https://attacker.example" }
        })
      )
    ).toThrow("origin");
    expect(() =>
      assertJsonRequest(
        new Request("https://homeroom.example/api/demo-sessions", {
          method: "POST",
          headers: { "content-type": "text/plain" }
        })
      )
    ).toThrow("JSON");
    expect(() =>
      assertSameOrigin(new Request("https://homeroom.example/api/demo-sessions", { method: "POST" }))
    ).toThrow("same-origin");
  });

  it("serializes a host-only hardened session cookie", () => {
    const cookie = serializeSessionCookie("signed.token", { secure: true, maxAgeSeconds: 7200 });
    expect(cookie).toContain("homeroom_session=signed.token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    const localCookie = serializeSessionCookie("local.token", { secure: false, maxAgeSeconds: -1 });
    expect(localCookie).toContain("Max-Age=0");
    expect(localCookie).not.toContain("Secure");
  });

  it("compares CSRF values against the stored hash", async () => {
    const hash = createHash("sha256").update("csrf-token").digest("hex");
    await expect(verifyCsrfToken("csrf-token", hash)).resolves.toBe(true);
    await expect(verifyCsrfToken("wrong-token", hash)).resolves.toBe(false);
    await expect(verifyCsrfToken("csrf-token", "invalid")).resolves.toBe(false);
  });
});
