import { buildGuardianDigest } from "../domain/guardian-inbox";
import type { GuardianDigestEmail } from "../notifications/guardian-digest-email";
import type { Logger } from "../observability/logger";
import type { RateLimiter } from "../security/rate-limit";
import type {
  GuardianDigestRecipient,
  GuardianInboxStore
} from "../storage/guardian-inbox-store";

export interface GuardianDigestCronStore extends GuardianInboxStore {
  listDigestRecipients(): Promise<GuardianDigestRecipient[]>;
}

export interface GuardianDigestCronDependencies {
  cronSecret: string;
  resendApiKey: string;
  digestFrom: string;
  rateLimiter: RateLimiter;
  store: GuardianDigestCronStore;
  sendEmail(input: {
    apiKey: string;
    from: string;
    email: GuardianDigestEmail;
  }): Promise<{ providerMessageId: string }>;
  logger: Logger;
  now?: () => Date;
  randomUUID?: () => string;
}

async function matchesSecret(actual: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([actual, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  ));
  let result = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    result |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return result === 0;
}

export async function handleGuardianDigestCron(
  request: Request,
  dependencies: GuardianDigestCronDependencies
): Promise<Response> {
  try {
    if (dependencies.cronSecret.length < 32) {
      return Response.json({
        error: {
          code: "SERVICE_NOT_CONFIGURED",
          message: "Weekly email delivery is not securely configured."
        }
      }, { status: 503 });
    }

    const clientKey = request.headers.get("cf-connecting-ip") ?? "scheduled-worker";
    if (!(await dependencies.rateLimiter.consume(clientKey))) {
      return Response.json({
        error: {
          code: "RATE_LIMITED",
          message: "Weekly email delivery was requested too many times."
        }
      }, { status: 429 });
    }

    if (!(await matchesSecret(
      request.headers.get("x-homeroom-cron") ?? "",
      dependencies.cronSecret
    ))) {
      return Response.json({
        error: {
          code: "AUTH_REQUIRED",
          message: "Cron authorization is required."
        }
      }, { status: 401 });
    }

    if (!dependencies.resendApiKey || !dependencies.digestFrom) {
      return Response.json({
        error: {
          code: "EMAIL_NOT_CONFIGURED",
          message: "Weekly email delivery is not configured."
        }
      }, { status: 503 });
    }

    const recipients = await dependencies.store.listDigestRecipients();
    let sent = 0;
    for (const recipient of recipients) {
      try {
        const digest = await buildGuardianDigest({
          recipientId: recipient.recipientId,
          recipientEmail: recipient.recipientEmail,
          store: dependencies.store,
          now: dependencies.now,
          randomUUID: dependencies.randomUUID
        });
        const receipt = await dependencies.sendEmail({
          apiKey: dependencies.resendApiKey,
          from: dependencies.digestFrom,
          email: {
            to: recipient.recipientEmail,
            subject: digest.subject,
            text: digest.text
          }
        });
        await dependencies.store.recordDigest({
          id: dependencies.randomUUID?.() ?? crypto.randomUUID(),
          recipientId: recipient.recipientId,
          recipientEmail: recipient.recipientEmail,
          notificationIds: digest.notificationIds,
          status: "sent",
          providerMessageId: receipt.providerMessageId,
          createdAt: (dependencies.now?.() ?? new Date()).toISOString()
        });
        sent += 1;
      } catch (error) {
        dependencies.logger.error("delivery_failed", error, {
          recipientId: recipient.recipientId
        });
      }
    }

    return Response.json({ ok: true, recipients: recipients.length, sent });
  } catch (error) {
    dependencies.logger.error("request_failed", error);
    return Response.json({
      error: {
        code: "DIGEST_UNAVAILABLE",
        message: "Weekly email delivery is unavailable right now."
      }
    }, { status: 500 });
  }
}
