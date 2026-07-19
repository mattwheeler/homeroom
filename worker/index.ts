import handler from "vinext/server/app-router-entry";

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface WorkerBindingsLike {
  ASSETS?: { fetch(request: Request): Promise<Response> | Response };
  HOMEROOM_DB?: unknown;
  SESSION_SIGNING_SECRET?: string;
  OPENAI_API_KEY?: string;
  SOURCE_TOKEN_ENCRYPTION_KEY?: string;
  GOOGLE_CLASSROOM_CLIENT_ID?: string;
  GOOGLE_CLASSROOM_CLIENT_SECRET?: string;
  GOOGLE_CLASSROOM_REDIRECT_URI?: string;
  CRON_SECRET?: string;
  RESEND_API_KEY?: string;
  GUARDIAN_DIGEST_FROM?: string;
}

const worker = {
  fetch(request: Request, bindings: WorkerBindingsLike, context: ExecutionContextLike) {
    return handler.fetch(request, bindings, context);
  },
  scheduled(_event: unknown, bindings: WorkerBindingsLike, context: ExecutionContextLike) {
    if (!bindings.CRON_SECRET) return;
    context.waitUntil(handler.fetch(new Request("https://homeroom.internal/api/cron/guardian-digest", {
      method: "POST",
      headers: { "x-homeroom-cron": bindings.CRON_SECRET }
    }), bindings, context).then(() => undefined));
  }
};

export default worker;
