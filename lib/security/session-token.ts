export type SessionRole = "student" | "guardian";

export interface SessionTokenPayload {
  sessionId: string;
  role: SessionRole;
  expiresAt: number;
}

export class SessionTokenError extends Error {
  constructor(readonly code: "INVALID_SESSION" | "SESSION_EXPIRED", message: string) {
    super(message);
    this.name = "SessionTokenError";
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, "base64url");
  const copy = new Uint8Array(decoded.length);
  copy.set(decoded);
  return copy;
}

async function importHmacKey(secret: string) {
  if (secret.length < 32) throw new SessionTokenError("INVALID_SESSION", "Session signing secret is too short.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function validatePayload(value: unknown): SessionTokenPayload {
  if (!value || typeof value !== "object") {
    throw new SessionTokenError("INVALID_SESSION", "Invalid session payload.");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.sessionId !== "string" ||
    !["student", "guardian"].includes(String(payload.role)) ||
    typeof payload.expiresAt !== "number"
  ) {
    throw new SessionTokenError("INVALID_SESSION", "Invalid session payload.");
  }
  return payload as unknown as SessionTokenPayload;
}

export async function signSessionToken(payload: SessionTokenPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret),
    new TextEncoder().encode(encodedPayload)
  );
  return encodedPayload + "." + base64UrlEncode(new Uint8Array(signature));
}

export async function verifySessionToken(token: string, secret: string, now: number): Promise<SessionTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new SessionTokenError("INVALID_SESSION", "Invalid session token.");
  }
  const verified = await crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret),
    base64UrlDecode(parts[1]),
    new TextEncoder().encode(parts[0])
  );
  if (!verified) throw new SessionTokenError("INVALID_SESSION", "Invalid session token.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  } catch {
    throw new SessionTokenError("INVALID_SESSION", "Invalid session payload.");
  }
  const payload = validatePayload(decoded);
  if (payload.expiresAt < now) throw new SessionTokenError("SESSION_EXPIRED", "Session expired.");
  return payload;
}
