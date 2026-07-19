import { env } from "cloudflare:workers";

import {
  connectOfficialSchoolCalendar,
  connectOfficialSupplyList,
  syncOfficialSchoolSources
} from "../../../../lib/domain/official-school-sources";
import { handleOfficialSchoolSource } from "../../../../lib/http/official-school-source-handler";
import { D1FixedWindowRateLimiter } from "../../../../lib/security/rate-limit";
import { D1SchoolSourceStore } from "../../../../lib/storage/school-source-store";
import { D1SessionStore } from "../../../../lib/storage/session-store";

const limiter = new D1FixedWindowRateLimiter(env.HOMEROOM_DB, { limit: 12, windowMs: 60_000, namespace: "school-sources" });

export async function POST(request: Request) {
  if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) {
    return Response.json(
      { error: { code: "SERVICE_NOT_CONFIGURED", message: "Official school sources are not configured yet." } },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const sessions = new D1SessionStore(env.HOMEROOM_DB);
  const sources = new D1SchoolSourceStore(env.HOMEROOM_DB);
  return handleOfficialSchoolSource(request, {
    store: sessions,
    signingSecret: env.SESSION_SIGNING_SECRET,
    rateLimiter: limiter,
    clientKey: request.headers.get("cf-connecting-ip") ?? "local-guardian-school",
    connectCalendar: (session, input) => connectOfficialSchoolCalendar({
      session,
      store: sources,
      schoolUrl: input.schoolUrl,
      districtCalendarUrl: input.districtCalendarUrl
    }),
    connectSupplies: (session, input) => connectOfficialSupplyList({
      session,
      store: sources,
      sourceUrl: input.sourceUrl
    }),
    sync: (session, provider) => syncOfficialSchoolSources({
      session,
      provider,
      store: sources
    })
  });
}
