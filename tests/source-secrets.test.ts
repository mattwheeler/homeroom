import { describe, expect, it } from "vitest";

import { openSourceSecret, sealSourceSecret } from "../lib/security/source-secrets";

describe("source connection secret envelope", () => {
  const key = "test-source-encryption-secret-at-least-thirty-two-characters";

  it("round-trips a provider secret without embedding plaintext", async () => {
    const sealed = await sealSourceSecret(
      "refresh-or-private-feed-token",
      key,
      () => Uint8Array.from({ length: 12 }, (_, index) => index + 1)
    );

    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("refresh-or-private-feed-token");
    await expect(openSourceSecret(sealed, key)).resolves.toBe("refresh-or-private-feed-token");
  });

  it("rejects weak keys, empty values, tampering, and unknown envelope versions", async () => {
    await expect(sealSourceSecret("value", "short")).rejects.toThrow(/32/);
    await expect(sealSourceSecret("", key)).rejects.toThrow(/empty/i);
    await expect(openSourceSecret("v2.abc.def", key)).rejects.toThrow(/version/i);

    const sealed = await sealSourceSecret("value", key);
    await expect(openSourceSecret(`${sealed.slice(0, -1)}x`, key)).rejects.toThrow(/decrypt/i);
  });
});
