import { describe, expect, it } from "vitest";

import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  clearGoogleOAuthIntentCookies,
  googleOAuthIntentCookie,
  resolveGoogleOAuthCallbackFlow
} from "../lib/http/google-oauth-flow";

function callback(cookie = "") {
  return new Request(`https://homeroom.example${GOOGLE_OAUTH_CALLBACK_PATH}?state=opaque&code=one-time`, {
    headers: cookie ? { cookie } : undefined
  });
}

describe("shared Google OAuth callback routing", () => {
  it("routes only from mutually exclusive HttpOnly intent cookies", () => {
    expect(resolveGoogleOAuthCallbackFlow(callback("homeroom_auth_intent=signed"))).toBe("identity");
    expect(resolveGoogleOAuthCallbackFlow(callback("homeroom_oauth_session=signed"))).toBe("classroom");
    expect(resolveGoogleOAuthCallbackFlow(callback())).toBe("invalid");
    expect(resolveGoogleOAuthCallbackFlow(callback(
      "homeroom_auth_intent=signed; homeroom_oauth_session=signed"
    ))).toBe("invalid");
  });

  it("does not accept a query parameter as a flow selector", () => {
    const request = new Request(
      `https://homeroom.example${GOOGLE_OAUTH_CALLBACK_PATH}?flow=classroom&state=opaque&code=one-time`
    );
    expect(resolveGoogleOAuthCallbackFlow(request)).toBe("invalid");
  });

  it("scopes and clears both flow cookies on the shared callback", () => {
    const cookie = googleOAuthIntentCookie({
      name: "homeroom_oauth_session",
      value: "signed",
      maxAge: 600,
      secure: true
    });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`Path=${GOOGLE_OAUTH_CALLBACK_PATH}`);

    const cleared = clearGoogleOAuthIntentCookies(true);
    expect(cleared).toHaveLength(2);
    expect(cleared.every((value) => value.includes("Max-Age=0"))).toBe(true);
  });
});
