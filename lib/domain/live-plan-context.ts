import type { StudentSourceProjection } from "./student-source-projection";

function stableEvidence(projection: StudentSourceProjection) {
  return {
    generatedAt: projection.generatedAt,
    localDate: projection.context.localDate,
    priorities: projection.priorities.map((item) => ({
      id: item.id,
      title: item.title,
      courseName: item.course.name,
      due: item.due,
      effort: item.effort,
      chunks: item.chunks,
      source: item.source
    })),
    timeline: projection.today.timeline,
    classes: projection.classes ?? []
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildLivePlanContext(projection: StudentSourceProjection, now: Date) {
  const evidence = stableEvidence(projection);
  return {
    mode: "live" as const,
    builtAt: now.toISOString(),
    localDate: projection.context.localDate,
    priorities: evidence.priorities,
    timeline: evidence.timeline,
    classes: evidence.classes,
    sourceFingerprint: await sha256Hex(JSON.stringify(evidence)),
    policy: {
      proposalOnly: true,
      requiresStudentApprovalToSave: true,
      sourceTextIsUntrusted: true
    }
  };
}
