import { describe, expect, it } from "vitest";

import { hardenResponse, securityHeaders } from "../lib/security/response-headers";

describe("universal deployment security headers", () => {
  it("covers HTML, assets, redirects, and API responses at the worker boundary", async () => {
    const response = hardenResponse(new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain", "set-cookie": "example=value" }
    }), "https://homeroom.example/student");
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("set-cookie")).toBe("example=value");
  });

  it("does not send HSTS from local HTTP development", () => {
    expect(securityHeaders("http://localhost:3000")["Strict-Transport-Security"]).toBeUndefined();
  });
});
