import { readCookie, verifyCsrfToken } from "../security/http";
import { verifySessionToken, type SessionRole } from "../security/session-token";
import type { SessionRecord, SessionStore } from "../storage/session-store";

export class AuthenticatedSessionError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthenticatedSessionError";
  }
}

export async function authenticatedSession(input: {
  request: Request;
  store: SessionStore;
  signingSecret: string;
  role: SessionRole;
  requireCsrf?: boolean;
  now?: Date;
}): Promise<SessionRecord> {
  const token = readCookie(input.request, "homeroom_session");
  if (!token) throw new AuthenticatedSessionError(401, "Sign in to Homeroom first.");
  const now = input.now ?? new Date();
  const payload = await verifySessionToken(token, input.signingSecret, now.getTime());
  if (payload.role !== input.role) throw new AuthenticatedSessionError(403, "This workspace belongs to the other family role.");
  const session = await input.store.findById(payload.sessionId);
  if (!session || session.role !== input.role || Date.parse(session.expiresAt) < now.getTime()) {
    throw new AuthenticatedSessionError(401, "Your Homeroom session has expired.");
  }
  if (input.requireCsrf !== false) {
    const csrf = input.request.headers.get("x-homeroom-csrf") ?? "";
    if (csrf.length > 256 || !(await verifyCsrfToken(csrf, session.csrfHash))) {
      throw new AuthenticatedSessionError(403, "The request could not be verified.");
    }
  }
  return session;
}
