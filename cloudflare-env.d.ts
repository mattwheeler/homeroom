declare module "cloudflare:workers" {
  export const env: {
    HOMEROOM_DB: import("./lib/storage/session-store").D1DatabaseLike;
    SESSION_SIGNING_SECRET?: string;
    OPENAI_API_KEY?: string;
  };
}
