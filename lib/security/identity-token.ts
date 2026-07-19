import type { SessionRole } from "./session-token";

export interface VerifiedIdentity {
  provider: "google";
  subject: string;
  email: string;
  role: SessionRole;
}

interface IdentityTokenPayload extends VerifiedIdentity {
  purpose: "homeroom_identity";
  expiresAt: number;
}

export class IdentityTokenError extends Error {
  constructor(readonly code: "INVALID_IDENTITY" | "IDENTITY_EXPIRED", message: string) {
    super(message);
    this.name = "IdentityTokenError";
  }
}

function encode(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(value, "base64url");
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

async function key(secret: string) {
  if (secret.length < 32) throw new IdentityTokenError("INVALID_IDENTITY", "Identity signing secret is too short.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function payload(value: unknown): IdentityTokenPayload {
  if (!value || typeof value !== "object") throw new IdentityTokenError("INVALID_IDENTITY", "Invalid identity token.");
  const candidate = value as Partial<IdentityTokenPayload>;
  if (
    candidate.purpose !== "homeroom_identity" ||
    candidate.provider !== "google" ||
    typeof candidate.subject !== "string" || !candidate.subject || candidate.subject.length > 255 ||
    typeof candidate.email !== "string" || !candidate.email || candidate.email.length > 320 ||
    (candidate.role !== "student" && candidate.role !== "guardian") ||
    typeof candidate.expiresAt !== "number"
  ) throw new IdentityTokenError("INVALID_IDENTITY", "Invalid identity token.");
  return candidate as IdentityTokenPayload;
}

export async function signIdentityToken(
  identity: VerifiedIdentity,
  signingSecret: string,
  expiresAt: number
): Promise<string> {
  const body = encode(JSON.stringify({ ...identity, purpose: "homeroom_identity", expiresAt } satisfies IdentityTokenPayload));
  const signature = await crypto.subtle.sign("HMAC", await key(signingSecret), new TextEncoder().encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}

export async function verifyIdentityToken(token: string, signingSecret: string, now: number): Promise<VerifiedIdentity> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new IdentityTokenError("INVALID_IDENTITY", "Invalid identity token.");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(signingSecret),
    decode(parts[1]),
    new TextEncoder().encode(parts[0])
  );
  if (!valid) throw new IdentityTokenError("INVALID_IDENTITY", "Invalid identity token.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  } catch {
    throw new IdentityTokenError("INVALID_IDENTITY", "Invalid identity token.");
  }
  const value = payload(parsed);
  if (value.expiresAt < now) throw new IdentityTokenError("IDENTITY_EXPIRED", "Identity session expired.");
  return {
    provider: value.provider,
    subject: value.subject,
    email: value.email,
    role: value.role
  };
}
