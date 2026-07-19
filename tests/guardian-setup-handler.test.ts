import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { defaultGuardianSetupSettings } from "../lib/domain/guardian-setup-profile";
import { handleGuardianSetup } from "../lib/http/guardian-setup-handler";
import type { RateLimiter } from "../lib/security/rate-limit";
import { signSessionToken } from "../lib/security/session-token";
import { GuardianSetupStoreError } from "../lib/storage/guardian-setup-store";
import type { SessionRecord, SessionStore } from "../lib/storage/session-store";

const signingSecret = "a-test-only-secret-that-is-at-least-thirty-two-characters";
const csrfToken = "csrf-guardian-setup";
const expiresAt = Date.parse("2026-07-18T23:00:00.000Z");
const allow: RateLimiter = { consume: () => true };
const now = () => new Date("2026-07-18T22:00:00.000Z");

function session(role: "student" | "guardian" = "guardian"): SessionRecord {
  return {
    id: "session_guardian",
    fixtureKey: "emily_band_camp_v1",
    actorId: role === "guardian" ? "guardian_matt" : "student_emily",
    role,
    state: { phase: "ORIENTATION_READY", stateVersion: 5, sourceVersion: 1, activePlanVersion: null },
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    expiresAt: new Date(expiresAt).toISOString(),
    createdAt: "2026-07-18T21:00:00.000Z",
    updatedAt: "2026-07-18T21:00:00.000Z"
  };
}

class MemorySessionStore implements SessionStore {
  constructor(private readonly value: SessionRecord | null) {}
  async create() {}
  async findById() { return this.value; }
}

async function request(body: unknown, options: {
  role?: "student" | "guardian";
  csrf?: string;
  origin?: string;
  includeCookie?: boolean;
} = {}) {
  const role = options.role ?? "guardian";
  const token = await signSessionToken({ sessionId: "session_guardian", role, expiresAt }, signingSecret);
  const headers: Record<string, string> = {
    origin: options.origin ?? "https://homeroom.example",
    "content-type": "application/json",
    "x-homeroom-csrf": options.csrf ?? csrfToken
  };
  if (options.includeCookie !== false) headers.cookie = `homeroom_session=${encodeURIComponent(token)}`;
  return new Request("https://homeroom.example/api/guardian/setup", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function dependencies(role: "student" | "guardian" = "guardian") {
  return {
    store: new MemorySessionStore(session(role)),
    signingSecret,
    rateLimiter: allow,
    clientKey: "test",
    now,
    read: vi.fn().mockResolvedValue({ settingsVersion: 0, settings: defaultGuardianSetupSettings() }),
    save: vi.fn().mockResolvedValue({ settingsVersion: 1, settings: defaultGuardianSetupSettings() })
  };
}

describe("guardian setup HTTP handler", () => {
  it("lets only an authenticated guardian read and save Emily's settings", async () => {
    const deps = dependencies();
    const readResponse = await handleGuardianSetup(await request({ action: "read" }), deps);
    expect(readResponse.status).toBe(200);
    expect(readResponse.headers.get("cache-control")).toBe("no-store");
    expect(deps.read).toHaveBeenCalledWith(session("guardian"));

    const settings = defaultGuardianSetupSettings();
    const saveResponse = await handleGuardianSetup(await request({
      action: "save",
      expectedVersion: 0,
      settings
    }), deps);
    expect(saveResponse.status).toBe(200);
    expect(deps.save).toHaveBeenCalledWith(session("guardian"), { expectedVersion: 0, settings });
  });

  it("rejects student sessions, missing auth, cross-origin requests, bad CSRF, and rate limits", async () => {
    await expect(handleGuardianSetup(
      await request({ action: "read" }, { role: "student" }),
      dependencies("student")
    )).resolves.toMatchObject({ status: 403 });
    await expect(handleGuardianSetup(
      await request({ action: "read" }, { includeCookie: false }),
      dependencies()
    )).resolves.toMatchObject({ status: 401 });
    await expect(handleGuardianSetup(
      await request({ action: "read" }, { origin: "https://attacker.example" }),
      dependencies()
    )).resolves.toMatchObject({ status: 403 });
    await expect(handleGuardianSetup(
      await request({ action: "read" }, { csrf: "wrong" }),
      dependencies()
    )).resolves.toMatchObject({ status: 403 });
    await expect(handleGuardianSetup(await request({ action: "read" }), {
      ...dependencies(), rateLimiter: { consume: () => false }
    })).resolves.toMatchObject({ status: 429 });
  });

  it("rejects attempts to grant write access, share private coaching, or inject extra fields", async () => {
    const settings = defaultGuardianSetupSettings();
    const deps = dependencies();
    const unsafe = {
      ...settings,
      privacy: { ...settings.privacy, sharePrivateCoaching: true },
      sourcePermissions: {
        ...settings.sourcePermissions,
        googleClassroom: { enabled: true, access: "write" }
      },
      token: "do-not-accept"
    };
    const response = await handleGuardianSetup(await request({
      action: "save",
      expectedVersion: 0,
      settings: unsafe
    }), deps);

    expect(response.status).toBe(400);
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("maps stale writes and unexpected failures without leaking internal details", async () => {
    const stale = dependencies();
    stale.save.mockRejectedValue(new GuardianSetupStoreError("database version 7"));
    const staleResponse = await handleGuardianSetup(await request({
      action: "save", expectedVersion: 0, settings: defaultGuardianSetupSettings()
    }), stale);
    expect(staleResponse.status).toBe(409);
    expect(JSON.stringify(await staleResponse.json())).not.toContain("version 7");

    const failed = dependencies();
    failed.read.mockRejectedValue(new Error("secret database internals"));
    const failedResponse = await handleGuardianSetup(await request({ action: "read" }), failed);
    expect(failedResponse.status).toBe(500);
    expect(JSON.stringify(await failedResponse.json())).not.toContain("secret database internals");
  });
});
