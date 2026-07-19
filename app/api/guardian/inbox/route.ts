import { env } from "cloudflare:workers";
import { z } from "zod";

import { acknowledgeGuardianNotification, buildGuardianDigest, listGuardianInbox } from "../../../../lib/domain/guardian-inbox";
import { authenticatedSession, AuthenticatedSessionError } from "../../../../lib/http/authenticated-session";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { assertJsonRequest, assertSameOrigin, HttpSecurityError } from "../../../../lib/security/http";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { SessionTokenError } from "../../../../lib/security/session-token";
import { D1GuardianInboxStore } from "../../../../lib/storage/guardian-inbox-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";
import { sendGuardianDigestEmail } from "../../../../lib/notifications/guardian-digest-email";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("acknowledge"), notificationId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("digest") }).strict(),
  z.object({ action: z.literal("send_digest") }).strict()
]);

const logger = new StructuredLogger("guardian-inbox");

export async function POST(request: Request) {
  try {
    if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) throw new Error("Identity is not configured.");
    assertSameOrigin(request);
    assertJsonRequest(request);
    const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 30, windowMs: 60_000, namespace: "guardian-inbox" });
    if (!(await limiter.consume(request.headers.get("cf-connecting-ip") ?? "local"))) {
      return Response.json({ error: { code: "RATE_LIMITED", message: "Take a short pause before checking family notes." } }, { status: 429 });
    }
    const sessions = new D1SessionStore(env.HOMEROOM_DB);
    const session = await authenticatedSession({ request, store: sessions, signingSecret: env.SESSION_SIGNING_SECRET, role: "guardian" });
    if (!(await limiter.consume(`session:${session.id}`))) {
      return Response.json({ error: { code: "RATE_LIMITED", message: "Take a short pause before checking family notes." } }, { status: 429 });
    }
    const body = requestSchema.parse(await request.json());
    const store = new D1GuardianInboxStore(env.HOMEROOM_DB);
    if (body.action === "list") return Response.json(await listGuardianInbox({ recipientId: session.actorId, store }));
    if (body.action === "acknowledge") {
      return Response.json(await acknowledgeGuardianNotification({ recipientId: session.actorId, notificationId: body.notificationId, store }));
    }
    const digest = await buildGuardianDigest({
      recipientId: session.actorId,
      recipientEmail: session.identityEmail ?? "guardian@household.invalid",
      store
    });
    if (body.action === "digest") return Response.json(digest);
    if (!env.RESEND_API_KEY || !env.GUARDIAN_DIGEST_FROM || !session.identityEmail) {
      return Response.json({ error: { code: "EMAIL_NOT_CONFIGURED", message: "Weekly email delivery is not configured yet. The inbox and preview are still ready." } }, { status: 503 });
    }
    const delivered = await sendGuardianDigestEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.GUARDIAN_DIGEST_FROM,
      email: { to: session.identityEmail, subject: digest.subject, text: digest.text }
    });
    await store.recordDigest({
      id: crypto.randomUUID(), recipientId: session.actorId, recipientEmail: session.identityEmail,
      notificationIds: digest.notificationIds, status: "sent", providerMessageId: delivered.providerMessageId,
      createdAt: new Date().toISOString()
    });
    return Response.json({ sent: true, ...delivered });
  } catch (error) {
    logger.error("request_failed", error);
    if (error instanceof AuthenticatedSessionError) return Response.json({ error: { code: "AUTH_REQUIRED", message: error.message } }, { status: error.status });
    if (error instanceof HttpSecurityError) return Response.json({ error: { code: "REQUEST_REJECTED", message: error.message } }, { status: error.status });
    if (error instanceof SessionTokenError) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in again." } }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid guardian inbox request." } }, { status: 400 });
    return Response.json({ error: { code: "INBOX_UNAVAILABLE", message: "Family notes are unavailable right now." } }, { status: 500 });
  }
}
