import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  signIdentityToken,
  type VerifiedIdentity
} from "../security/identity-token";
import type { SessionRole } from "../security/session-token";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

interface IntentPayload {
  purpose: "google_identity_intent";
  role: SessionRole;
  stateHash: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

export interface GoogleIdentityClaims {
  subject: string;
  email: string;
  emailVerified: boolean;
  nonce: string | null;
}

export class GoogleIdentityError extends Error {
  readonly code:
    | "IDENTITY_INTENT_INVALID"
    | "IDENTITY_STATE_INVALID"
    | "IDENTITY_EXCHANGE_FAILED"
    | "IDENTITY_TOKEN_INVALID"
    | "IDENTITY_EMAIL_UNVERIFIED"
    | "IDENTITY_NOT_ALLOWED"
    | "IDENTITY_ROLE_MISMATCH";

  constructor(code: GoogleIdentityError["code"], message: string) {
    super(message);
    this.name = "GoogleIdentityError";
    this.code = code;
  }
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(value, "base64url");
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

async function hmacKey(secret: string) {
  if (secret.length < 32) throw new GoogleIdentityError("IDENTITY_INTENT_INVALID", "Identity authentication is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sha256Hex(value: string): Promise<string> {
  return Array.from(await sha256Bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signIntent(payload: IntentPayload, secret: string): Promise<string> {
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

async function verifyIntent(token: string, secret: string, now: number): Promise<IntentPayload> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new GoogleIdentityError("IDENTITY_INTENT_INVALID", "The sign-in request is invalid.");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    decode(parts[1]),
    new TextEncoder().encode(parts[0])
  );
  if (!valid) throw new GoogleIdentityError("IDENTITY_INTENT_INVALID", "The sign-in request is invalid.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  } catch {
    throw new GoogleIdentityError("IDENTITY_INTENT_INVALID", "The sign-in request is invalid.");
  }
  if (!value || typeof value !== "object") throw new GoogleIdentityError("IDENTITY_INTENT_INVALID", "The sign-in request is invalid.");
  const candidate = value as Partial<IntentPayload>;
  if (
    candidate.purpose !== "google_identity_intent" ||
    (candidate.role !== "student" && candidate.role !== "guardian") ||
    typeof candidate.stateHash !== "string" || !/^[a-f0-9]{64}$/.test(candidate.stateHash) ||
    typeof candidate.nonce !== "string" || candidate.nonce.length < 32 ||
    typeof candidate.codeVerifier !== "string" || candidate.codeVerifier.length < 43 ||
    typeof candidate.expiresAt !== "number" || candidate.expiresAt < now
  ) throw new GoogleIdentityError("IDENTITY_INTENT_INVALID", "The sign-in request is invalid or expired.");
  return candidate as IntentPayload;
}

export async function createGoogleIdentityAuthorization(input: {
  role: SessionRole;
  clientId: string;
  redirectUri: string;
  signingSecret: string;
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
}) {
  const random = input.randomBytes ?? ((size: number) => crypto.getRandomValues(new Uint8Array(size)));
  const state = base64Url(random(32));
  const nonce = base64Url(random(32));
  const codeVerifier = base64Url(random(32));
  const codeChallenge = base64Url(await sha256Bytes(codeVerifier));
  const now = (input.now ?? (() => new Date()))();
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return {
    authorizationUrl: url.toString(),
    intentToken: await signIntent({
      purpose: "google_identity_intent",
      role: input.role,
      stateHash: await sha256Hex(state),
      nonce,
      codeVerifier,
      expiresAt: now.getTime() + 10 * 60_000
    }, input.signingSecret)
  };
}

async function exchangeCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ idToken: string }> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier
      }).toString()
    });
  } catch {
    throw new GoogleIdentityError("IDENTITY_EXCHANGE_FAILED", "Google sign-in could not be completed.");
  }
  if (!response.ok) throw new GoogleIdentityError("IDENTITY_EXCHANGE_FAILED", "Google sign-in could not be completed.");
  const body = await response.json() as { id_token?: unknown };
  if (typeof body.id_token !== "string" || !body.id_token) {
    throw new GoogleIdentityError("IDENTITY_EXCHANGE_FAILED", "Google did not return an identity token.");
  }
  return { idToken: body.id_token };
}

async function verifyGoogleIdToken(input: {
  idToken: string;
  audience: string;
  nonce: string;
}): Promise<GoogleIdentityClaims> {
  try {
    const result = await jwtVerify(input.idToken, GOOGLE_JWKS, {
      audience: input.audience,
      issuer: ["https://accounts.google.com", "accounts.google.com"]
    });
    return {
      subject: result.payload.sub ?? "",
      email: typeof result.payload.email === "string" ? result.payload.email : "",
      emailVerified: result.payload.email_verified === true,
      nonce: typeof result.payload.nonce === "string" ? result.payload.nonce : null
    };
  } catch {
    throw new GoogleIdentityError("IDENTITY_TOKEN_INVALID", "Google identity verification failed.");
  }
}

function allowed(email: string, values: string[]): boolean {
  const normalized = email.trim().toLowerCase();
  return values.some((value) => value.trim().toLowerCase() === normalized);
}

export async function completeGoogleIdentityAuthorization(input: {
  intentToken: string;
  state: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  signingSecret: string;
  guardianEmails: string[];
  studentEmails: string[];
  exchange?: typeof exchangeCode;
  verifyIdToken?: typeof verifyGoogleIdToken;
  now?: () => Date;
}) {
  const now = (input.now ?? (() => new Date()))();
  const intent = await verifyIntent(input.intentToken, input.signingSecret, now.getTime());
  if (input.state.length > 512 || await sha256Hex(input.state) !== intent.stateHash) {
    throw new GoogleIdentityError("IDENTITY_STATE_INVALID", "The sign-in response could not be verified.");
  }
  if (!input.code || input.code.length > 4_096) throw new GoogleIdentityError("IDENTITY_EXCHANGE_FAILED", "Google sign-in could not be completed.");
  const token = await (input.exchange ?? exchangeCode)({
    code: input.code,
    codeVerifier: intent.codeVerifier,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri
  });
  const claims = await (input.verifyIdToken ?? verifyGoogleIdToken)({
    idToken: token.idToken,
    audience: input.clientId,
    nonce: intent.nonce
  });
  if (!claims.subject || !claims.email || claims.nonce !== intent.nonce) {
    throw new GoogleIdentityError("IDENTITY_TOKEN_INVALID", "Google identity verification failed.");
  }
  if (!claims.emailVerified) throw new GoogleIdentityError("IDENTITY_EMAIL_UNVERIFIED", "Use a Google account with a verified email address.");
  const email = claims.email.trim().toLowerCase();
  const inGuardian = allowed(email, input.guardianEmails);
  const inStudent = allowed(email, input.studentEmails);
  if (!inGuardian && !inStudent) throw new GoogleIdentityError("IDENTITY_NOT_ALLOWED", "This Google account is not linked to the Homeroom household.");
  if ((intent.role === "guardian" && !inGuardian) || (intent.role === "student" && !inStudent)) {
    throw new GoogleIdentityError("IDENTITY_ROLE_MISMATCH", "This account is linked to the other Homeroom workspace.");
  }
  const identity: VerifiedIdentity = {
    provider: "google",
    subject: claims.subject,
    email,
    role: intent.role
  };
  return {
    identity,
    identityToken: await signIdentityToken(identity, input.signingSecret, now.getTime() + 8 * 60 * 60_000),
    redirectPath: intent.role === "student" ? "/student?auth=connected" : "/guardian?auth=connected"
  };
}
