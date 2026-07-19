import { env } from "cloudflare:workers";

import { buildGuardianDigest } from "../../../../lib/domain/guardian-inbox";
import { sendGuardianDigestEmail } from "../../../../lib/notifications/guardian-digest-email";
import { StructuredLogger } from "../../../../lib/observability/logger";
import { D1GuardianInboxStore } from "../../../../lib/storage/guardian-inbox-store";

const logger = new StructuredLogger("guardian-digest-cron");

async function matchesSecret(actual: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([actual, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  ));
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left[index]! ^ right[index]!;
  return result === 0;
}

export async function POST(request: Request) {
  if (!env.CRON_SECRET || !(await matchesSecret(request.headers.get("x-homeroom-cron") ?? "", env.CRON_SECRET))) {
    return Response.json({ error: { code: "AUTH_REQUIRED", message: "Cron authorization is required." } }, { status: 401 });
  }
  if (!env.RESEND_API_KEY || !env.GUARDIAN_DIGEST_FROM) {
    return Response.json({ error: { code: "EMAIL_NOT_CONFIGURED", message: "Weekly email delivery is not configured." } }, { status: 503 });
  }
  const store = new D1GuardianInboxStore(env.HOMEROOM_DB);
  const recipients = await store.listDigestRecipients();
  let sent = 0;
  for (const recipient of recipients) {
    try {
      const digest = await buildGuardianDigest({ recipientId: recipient.recipientId, recipientEmail: recipient.recipientEmail, store });
      const receipt = await sendGuardianDigestEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.GUARDIAN_DIGEST_FROM,
        email: { to: recipient.recipientEmail, subject: digest.subject, text: digest.text }
      });
      await store.recordDigest({
        id: crypto.randomUUID(), recipientId: recipient.recipientId, recipientEmail: recipient.recipientEmail,
        notificationIds: digest.notificationIds, status: "sent", providerMessageId: receipt.providerMessageId,
        createdAt: new Date().toISOString()
      });
      sent += 1;
    } catch (error) {
      logger.error("delivery_failed", error, { recipientId: recipient.recipientId });
    }
  }
  return Response.json({ ok: true, recipients: recipients.length, sent });
}
