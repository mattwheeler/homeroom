declare module "cloudflare:workers" {
  export const env: {
    HOMEROOM_DB: import("./lib/storage/session-store").D1DatabaseLike;
    SESSION_SIGNING_SECRET?: string;
    OPENAI_API_KEY?: string;
    SOURCE_TOKEN_ENCRYPTION_KEY?: string;
    GOOGLE_CLASSROOM_CLIENT_ID?: string;
    GOOGLE_CLASSROOM_CLIENT_SECRET?: string;
    GOOGLE_CLASSROOM_REDIRECT_URI?: string;
    GOOGLE_IDENTITY_REDIRECT_URI?: string;
    AUTH_GUARDIAN_EMAILS?: string;
    AUTH_STUDENT_EMAILS?: string;
    RESEND_API_KEY?: string;
    GUARDIAN_DIGEST_FROM?: string;
    CRON_SECRET?: string;
  };
}
