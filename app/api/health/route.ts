import { env } from "cloudflare:workers";

export async function GET() {
  const release = env.HOMEROOM_RELEASE_SHA ?? env.CF_VERSION_METADATA?.id ?? "development";
  try {
    const ready = await env.HOMEROOM_DB.prepare("SELECT 1 AS ready").bind().first<{ ready: number }>();
    if (ready?.ready !== 1) throw new Error("D1 readiness query did not return the expected value.");
    return Response.json(
      {
        status: "ok",
        service: "homeroom",
        database: "ready",
        release,
        modelTarget: "gpt-5.6-sol"
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("health_readiness_failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { status: "degraded", service: "homeroom", database: "unavailable", release },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } }
    );
  }
}
